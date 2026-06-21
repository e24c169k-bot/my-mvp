'use client'

import { Suspense } from 'react'
import { useEffect, useState } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

function FinishContent() {
  const { id: gameId } = useParams()
  const searchParams = useSearchParams()
  const seasonId = searchParams.get('season')
  const router = useRouter()

  const [game, setGame] = useState(null)
  const [loading, setLoading] = useState(true)
  const [calculating, setCalculating] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    supabase.from('games').select('*').eq('id', gameId).single()
      .then(({ data }) => { setGame(data); setLoading(false) })
  }, [gameId])

  async function calcStats() {
    setCalculating(true)

    // 打席結果を取得
    const { data: pas } = await supabase
      .from('plate_appearances')
      .select('*')
      .eq('game_id', gameId)

    // 打撃成績を選手ごとに集計
    const battingMap = {}
    for (const pa of (pas || [])) {
      if (!battingMap[pa.player_id]) {
        battingMap[pa.player_id] = { ab: 0, hits: 0, singles: 0, doubles: 0, triples: 0, hr: 0, bb: 0, hbp: 0, sf: 0 }
      }
      const b = battingMap[pa.player_id]
      const r = pa.result
      // 打数カウント（四球・死球・犠打・打撃妨害は打数に含まない）
      if (!['四球', '申告敬遠', 'デッドボール', 'バント', '打撃妨害'].includes(r)) b.ab++
      if (r === 'ヒット') { b.hits++; b.singles++ }
      if (r === '2B' || r === 'エン2B') { b.hits++; b.doubles++ }
      if (r === '3B') { b.hits++; b.triples++ }
      if (r === 'HR' || r === '走HR') { b.hits++; b.hr++ }
      if (r === '四球' || r === '申告敬遠') b.bb++
      if (r === 'デッドボール') b.hbp++
      if (r === 'バント') b.sf++
    }

    // 成績計算
    for (const [playerId, b] of Object.entries(battingMap)) {
      const avg = b.ab > 0 ? (b.hits / b.ab) : 0
      const obp_denom = b.ab + b.bb + b.hbp + b.sf
      const obp = obp_denom > 0 ? ((b.hits + b.bb + b.hbp) / obp_denom) : 0
      const slg = b.ab > 0 ? ((b.singles + b.doubles * 2 + b.triples * 3 + b.hr * 4) / b.ab) : 0
      const ops = obp + slg

      await supabase.from('stats').upsert({
        game_id: gameId,
        player_id: playerId,
        type: 'batting',
        at_bats: b.ab,
        hits: b.hits,
        doubles: b.doubles,
        triples: b.triples,
        home_runs: b.hr,
        walks: b.bb,
        hit_by_pitch: b.hbp,
        avg: Math.round(avg * 1000) / 1000,
        obp: Math.round(obp * 1000) / 1000,
        slg: Math.round(slg * 1000) / 1000,
        ops: Math.round(ops * 1000) / 1000,
      }, { onConflict: 'game_id,player_id,type' })
    }

    // 投球成績（pitches から集計）
    const { data: pitches } = await supabase
      .from('pitches')
      .select('*')
      .eq('game_id', gameId)

    const pitchingMap = {}
    for (const p of (pitches || [])) {
      if (!p.pitcher_id) continue
      if (!pitchingMap[p.pitcher_id]) {
        pitchingMap[p.pitcher_id] = { outs: 0, earnedRuns: 0, walks: 0, strikeouts: 0, hbp: 0 }
      }
      const pm = pitchingMap[p.pitcher_id]
      if (['ゴロアウト','フライアウト','ライナーアウト','バント','三振','DP','TP'].includes(p.result)) {
        pm.outs += p.result === 'DP' ? 2 : p.result === 'TP' ? 3 : 1
      }
      if (p.result === '三振') pm.strikeouts++
      if (p.result === '四球' || p.result === '申告敬遠') pm.walks++
      if (p.result === 'デッドボール') pm.hbp++
    }

    for (const [playerId, pm] of Object.entries(pitchingMap)) {
      const ip = Math.floor(pm.outs / 3) + (pm.outs % 3) / 10
      const era = pm.outs > 0 ? (pm.earnedRuns * 27 / pm.outs) : 0
      const bbper9 = pm.outs > 0 ? (pm.walks * 27 / pm.outs) : 0

      await supabase.from('stats').upsert({
        game_id: gameId,
        player_id: playerId,
        type: 'pitching',
        innings_pitched: Math.round(ip * 10) / 10,
        strikeouts: pm.strikeouts,
        walks: pm.walks,
        hit_by_pitch: pm.hbp,
        era: Math.round(era * 100) / 100,
        bb_per9: Math.round(bbper9 * 100) / 100,
      }, { onConflict: 'game_id,player_id,type' })
    }

    // 試合を終了状態に
    await supabase.from('games').update({ status: 'finished' }).eq('id', gameId)
    setDone(true)
    setCalculating(false)
  }

  if (loading) return <div className="flex items-center justify-center min-h-screen"><p className="text-gray-500">読み込み中...</p></div>

  return (
    <div className="max-w-md mx-auto min-h-screen bg-white">
      <header className="bg-gradient-to-r from-green-900 to-green-700 text-white px-4 py-3 flex items-center justify-between">
        <h1 className="text-base font-semibold">試合終了</h1>
        <Link href={`/games/${gameId}/record?season=${seasonId}`} className="text-xs text-green-200">← 記録に戻る</Link>
      </header>

      <div className="p-4">
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6">
          <p className="text-xs text-gray-500 mb-1">試合</p>
          <p className="font-bold text-base">vs {game?.opponent} — {game?.date}</p>
          <p className="text-3xl font-bold text-center mt-3 mb-1">{game?.score_us} - {game?.score_them}</p>
        </div>

        {!done ? (
          <>
            <p className="text-sm text-gray-600 mb-6">
              試合を終了すると、記録データから打撃・投球成績を自動計算します。
            </p>
            <button
              onClick={calcStats}
              disabled={calculating}
              className="w-full bg-green-700 text-white font-bold py-4 rounded-xl text-base disabled:opacity-50"
            >
              {calculating ? '計算中...' : '成績を計算して試合を終了'}
            </button>
            <Link
              href={`/games/${gameId}/record?season=${seasonId}`}
              className="block w-full text-center mt-3 py-3 border-2 border-gray-300 rounded-xl text-sm text-gray-600"
            >
              記録に戻る
            </Link>
          </>
        ) : (
          <>
            <div className="bg-green-100 border border-green-300 rounded-xl p-4 mb-6 text-center">
              <p className="text-2xl mb-2">✅</p>
              <p className="font-bold text-green-800">成績を計算しました</p>
            </div>
            <Link
              href={`/stats?season=${seasonId}`}
              className="block w-full text-center bg-green-700 text-white font-bold py-4 rounded-xl text-base"
            >
              成績一覧を見る
            </Link>
            <Link
              href={`/games?season=${seasonId}`}
              className="block w-full text-center mt-3 py-3 border-2 border-gray-300 rounded-xl text-sm text-gray-600"
            >
              試合一覧に戻る
            </Link>
          </>
        )}
      </div>
    </div>
  )
}

export default function FinishPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><p className="text-gray-500">読み込み中...</p></div>}>
      <FinishContent />
    </Suspense>
  )
}
