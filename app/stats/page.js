'use client'

import { Suspense } from 'react'
import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { getClientSession, getUserTeam } from '@/lib/team-client'

function StatsContent() {
  const searchParams = useSearchParams()
  const seasonId = searchParams.get('season')
  const teamIdParam = searchParams.get('team')
  const router = useRouter()
  const [tab, setTab] = useState('batting')
  const [teamId, setTeamId] = useState(teamIdParam || null)
  const [battingStats, setBattingStats] = useState([])
  const [pitchingStats, setPitchingStats] = useState([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    initialize()
  }, [seasonId, teamIdParam])

  async function initialize() {
    const { user } = await getClientSession()
    if (!user) {
      router.push('/auth')
      return
    }
    const { team } = await getUserTeam(user.id)
    if (!team?.team_id) {
      router.push('/onboarding')
      return
    }
    setTeamId(team.team_id)
    if (seasonId) fetchStats(team.team_id)
  }

  async function fetchStats(currentTeamId) {
    setErrorMsg('')
    // シーズン内の試合IDを取得
    const { data: games, error: gamesError } = await supabase
      .from('games')
      .select('id')
      .eq('season_id', seasonId)
      .eq('team_id', currentTeamId)
      .eq('status', 'finished')
    if (gamesError) {
      setErrorMsg(gamesError.message)
      setLoading(false)
      return
    }

    if (!games || games.length === 0) {
      setLoading(false)
      return
    }
    const gameIds = games.map(g => g.id)

    // 成績を取得（選手情報込み）
    const { data: statsData, error: statsError } = await supabase
      .from('stats')
      .select('*, players(name, number)')
      .in('game_id', gameIds)
      .eq('team_id', currentTeamId)
    if (statsError) {
      setErrorMsg(statsError.message)
      setLoading(false)
      return
    }

    // 選手ごとに集計
    const battingMap = {}
    const pitchingMap = {}

    for (const s of (statsData || [])) {
      if (s.type === 'batting') {
        if (!battingMap[s.player_id]) {
          battingMap[s.player_id] = {
            name: s.players?.name, number: s.players?.number,
            ab: 0, hits: 0, doubles: 0, triples: 0, hr: 0, walks: 0, hbp: 0
          }
        }
        const b = battingMap[s.player_id]
        b.ab += s.at_bats || 0
        b.hits += s.hits || 0
        b.doubles += s.doubles || 0
        b.triples += s.triples || 0
        b.hr += s.home_runs || 0
        b.walks += s.walks || 0
        b.hbp += s.hit_by_pitch || 0
      }
      if (s.type === 'pitching') {
        if (!pitchingMap[s.player_id]) {
          pitchingMap[s.player_id] = {
            name: s.players?.name, number: s.players?.number,
            outs: 0, strikeouts: 0, walks: 0, hbp: 0, earnedRuns: 0
          }
        }
        const p = pitchingMap[s.player_id]
        // innings_pitched を outs に変換（1.1回 = 4アウト）
        const ip = s.innings_pitched || 0
        p.outs += Math.floor(ip) * 3 + Math.round((ip % 1) * 10)
        p.strikeouts += s.strikeouts || 0
        p.walks += s.walks || 0
        p.hbp += s.hit_by_pitch || 0
      }
    }

    // 打撃成績を計算
    const batting = Object.values(battingMap).map(b => {
      const avg = b.ab > 0 ? b.hits / b.ab : 0
      const obpDenom = b.ab + b.walks + b.hbp
      const obp = obpDenom > 0 ? (b.hits + b.walks + b.hbp) / obpDenom : 0
      const slg = b.ab > 0 ? (b.hits - b.doubles - b.triples - b.hr + b.doubles * 2 + b.triples * 3 + b.hr * 4) / b.ab : 0
      return {
        ...b,
        avg: avg.toFixed(3),
        obp: obp.toFixed(3),
        slg: slg.toFixed(3),
        ops: (obp + slg).toFixed(3)
      }
    }).sort((a, b) => parseFloat(b.avg) - parseFloat(a.avg))

    // 投手成績を計算
    const pitching = Object.values(pitchingMap).map(p => {
      const ip = Math.floor(p.outs / 3) + (p.outs % 3) / 10
      const era = p.outs > 0 ? (p.earnedRuns * 27 / p.outs) : 0
      const bbPer9 = p.outs > 0 ? (p.walks * 27 / p.outs) : 0
      const kPer9 = p.outs > 0 ? (p.strikeouts * 27 / p.outs) : 0
      return {
        ...p,
        ip: ip.toFixed(1),
        era: era.toFixed(2),
        bbPer9: bbPer9.toFixed(1),
        kPer9: kPer9.toFixed(1)
      }
    }).sort((a, b) => parseFloat(a.era) - parseFloat(b.era))

    setBattingStats(batting)
    setPitchingStats(pitching)
    setLoading(false)
  }

  function downloadCSV() {
    const headers = tab === 'batting'
      ? ['選手', '背番号', '打数', '安打', '2B', '3B', 'HR', '四球', '打率', '出塁率', 'OPS']
      : ['選手', '背番号', '投球回', '奪三振', '与四球', '防御率', '与四球率/9', '奪三振/9']

    const rows = tab === 'batting'
      ? battingStats.map(b => [b.name, b.number, b.ab, b.hits, b.doubles, b.triples, b.hr, b.walks, b.avg, b.obp, b.ops])
      : pitchingStats.map(p => [p.name, p.number, p.ip, p.strikeouts, p.walks, p.era, p.bbPer9, p.kPer9])

    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `成績_${tab === 'batting' ? '打撃' : '投手'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <div className="flex items-center justify-center min-h-screen"><p className="text-gray-500">読み込み中...</p></div>

  return (
    <div className="max-w-md mx-auto min-h-screen bg-white">
      <header className="bg-gradient-to-r from-green-900 to-green-700 text-white px-4 py-3 flex items-center justify-between">
        <h1 className="text-base font-semibold">📊 成績一覧</h1>
        <Link href={`/?season=${seasonId}&team=${teamId}`} className="text-xs text-green-200">← ホーム</Link>
      </header>

      <div className="p-4">
        {errorMsg && <p className="text-sm text-red-600 mb-3">{errorMsg}</p>}

        {/* タブ */}
        <div className="flex gap-2 mb-4">
          <button onClick={() => setTab('batting')}
            className={`flex-1 py-2 rounded-lg font-semibold text-sm ${tab === 'batting' ? 'bg-green-700 text-white' : 'border border-gray-300 text-gray-700'}`}>
            打撃
          </button>
          <button onClick={() => setTab('pitching')}
            className={`flex-1 py-2 rounded-lg font-semibold text-sm ${tab === 'pitching' ? 'bg-green-700 text-white' : 'border border-gray-300 text-gray-700'}`}>
            投手
          </button>
        </div>

        {/* 打撃成績 */}
        {tab === 'batting' && (
          battingStats.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">成績データがありません<br /><span className="text-xs">試合終了後に成績計算を実行してください</span></p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-green-50">
                    <th className="text-left px-2 py-2 font-semibold text-gray-700">選手</th>
                    <th className="px-2 py-2 font-semibold text-gray-700">打数</th>
                    <th className="px-2 py-2 font-semibold text-gray-700">安打</th>
                    <th className="px-2 py-2 font-semibold text-gray-700">打率</th>
                    <th className="px-2 py-2 font-semibold text-gray-700">出塁率</th>
                    <th className="px-2 py-2 font-semibold text-gray-700">OPS</th>
                  </tr>
                </thead>
                <tbody>
                  {battingStats.map((b, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-2 py-2 font-semibold text-gray-900">#{b.number} {b.name}</td>
                      <td className="px-2 py-2 text-center text-gray-900">{b.ab}</td>
                      <td className="px-2 py-2 text-center text-gray-900">{b.hits}</td>
                      <td className="px-2 py-2 text-center font-bold text-gray-900">{b.avg}</td>
                      <td className="px-2 py-2 text-center text-gray-900">{b.obp}</td>
                      <td className="px-2 py-2 text-center font-bold text-green-800">{b.ops}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* 投手成績 */}
        {tab === 'pitching' && (
          pitchingStats.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">成績データがありません<br /><span className="text-xs">試合終了後に成績計算を実行してください</span></p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-green-50">
                    <th className="text-left px-2 py-2 font-semibold text-gray-700">選手</th>
                    <th className="px-2 py-2 font-semibold text-gray-700">投球回</th>
                    <th className="px-2 py-2 font-semibold text-gray-700">K</th>
                    <th className="px-2 py-2 font-semibold text-gray-700">BB</th>
                    <th className="px-2 py-2 font-semibold text-gray-700">防御率</th>
                    <th className="px-2 py-2 font-semibold text-gray-700">BB/9</th>
                  </tr>
                </thead>
                <tbody>
                  {pitchingStats.map((p, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-2 py-2 font-semibold text-gray-900">#{p.number} {p.name}</td>
                      <td className="px-2 py-2 text-center text-gray-900">{p.ip}</td>
                      <td className="px-2 py-2 text-center text-gray-900">{p.strikeouts}</td>
                      <td className="px-2 py-2 text-center text-gray-900">{p.walks}</td>
                      <td className="px-2 py-2 text-center font-bold text-gray-900">{p.era}</td>
                      <td className="px-2 py-2 text-center text-gray-900">{p.bbPer9}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        <button onClick={downloadCSV}
          className="w-full mt-4 py-3 bg-green-700 text-white font-semibold rounded-xl text-sm">
          📥 CSV 出力
        </button>
      </div>
    </div>
  )
}

export default function StatsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><p className="text-gray-500">読み込み中...</p></div>}>
      <StatsContent />
    </Suspense>
  )
}
