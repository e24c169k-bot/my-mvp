'use client'

import { Suspense } from 'react'
import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { getClientSession, getUserTeam } from '@/lib/team-client'

function NewGameContent() {
  const searchParams = useSearchParams()
  const seasonId = searchParams.get('season')
  const teamIdParam = searchParams.get('team')
  const router = useRouter()

  const [players, setPlayers] = useState([])
  const [teamId, setTeamId] = useState(teamIdParam || null)
  const [opponent, setOpponent] = useState('')
  const [opponentPitcherName, setOpponentPitcherName] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [battingTurn, setBattingTurn] = useState('first') // first | second
  const [lineup, setLineup] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const positions = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH']

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
    if (seasonId) fetchPlayers(team.team_id)
  }

  async function fetchPlayers(currentTeamId) {
    setErrorMsg('')
    const { data, error } = await supabase
      .from('players')
      .select('*')
      .eq('season_id', seasonId)
      .eq('team_id', currentTeamId)
      .order('number')
    if (error) {
      setErrorMsg(error.message)
      setLoading(false)
      return
    }
    setPlayers(data || [])
    setLineup((data || []).map((p, i) => ({
      playerId: p.id,
      battingOrder: i + 1,
      position: '',
      isStarter: false
    })))
    setLoading(false)
  }

  function toggleStarter(playerId) {
    setLineup(lineup.map(l =>
      l.playerId === playerId ? { ...l, isStarter: !l.isStarter } : l
    ))
  }

  function setOrder(playerId, order) {
    setLineup(lineup.map(l =>
      l.playerId === playerId ? { ...l, battingOrder: parseInt(order) || 0 } : l
    ))
  }

  function setPosition(playerId, pos) {
    setLineup(lineup.map(l =>
      l.playerId === playerId ? { ...l, position: pos } : l
    ))
  }

  async function createGame() {
    if (!opponent.trim() || !teamId) { alert('対戦相手を入力してください'); return }
    const starters = lineup.filter(l => l.isStarter)
    if (starters.length === 0) { alert('スタメンを1人以上選択してください'); return }
    setSaving(true)
    setErrorMsg('')

    const initialState = {
      inning: 1,
      inningHalf: battingTurn === 'first' ? 'top' : 'bottom',
      balls: 0,
      strikes: 0,
      outs: 0,
      runners: { '1塁': null, '2塁': null, '3塁': null },
      batterIndex: 0,
      usBattingTurn: battingTurn,
      opponentPitcherName: opponentPitcherName.trim()
    }

    const { data: game, error: gameError } = await supabase
      .from('games')
      .insert({
        season_id: seasonId,
        team_id: teamId,
        opponent: opponent.trim(),
        date,
        status: 'active',
        score_us: 0,
        score_them: 0,
        state_json: initialState
      })
      .select()
      .single()
    if (gameError) {
      setErrorMsg(gameError.message)
      setSaving(false)
      return
    }

    if (game) {
      // Save both starters and bench players so substitutions can use bench entries.
      const lineupData = lineup.map(l => ({
        game_id: game.id,
        team_id: teamId,
        player_id: l.playerId,
        batting_order: l.battingOrder || 0,
        position: l.isStarter ? l.position : '',
        is_starter: l.isStarter
      }))
      const { error: lineupError } = await supabase.from('lineups').insert(lineupData)
      if (lineupError) {
        setErrorMsg(lineupError.message)
        setSaving(false)
        return
      }
      router.push(`/games/${game.id}/record?season=${seasonId}&team=${teamId}`)
    }
    setSaving(false)
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <p className="text-gray-500">読み込み中...</p>
    </div>
  )

  return (
    <div className="max-w-md mx-auto min-h-screen bg-white">
      <header className="bg-gradient-to-r from-green-900 to-green-700 text-white px-4 py-3 flex items-center justify-between">
        <h1 className="text-base font-semibold">試合作成・スタメン設定</h1>
        <Link href={`/games?season=${seasonId}&team=${teamId}`} className="text-xs text-green-200">← 戻る</Link>
      </header>

      <div className="p-4">
        {errorMsg && <p className="text-sm text-red-600 mb-3">{errorMsg}</p>}
        <label className="block text-xs text-gray-600 mb-1">試合日 <span className="text-red-500">*</span></label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3" />

        <label className="block text-xs text-gray-600 mb-1">対戦相手 <span className="text-red-500">*</span></label>
        <input type="text" value={opponent} onChange={e => setOpponent(e.target.value)}
          placeholder="例: ライオンズ"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4" />

        <label className="block text-xs text-gray-600 mb-1">相手投手（任意）</label>
        <input
          type="text"
          value={opponentPitcherName}
          onChange={e => setOpponentPitcherName(e.target.value)}
          placeholder="例: 佐藤"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4"
        />

        <label className="block text-xs text-gray-600 mb-1">攻撃順 <span className="text-red-500">*</span></label>
        <div className="grid grid-cols-2 gap-2 mb-4">
          <button
            type="button"
            onClick={() => setBattingTurn('first')}
            className={`py-2 rounded-lg border-2 text-sm font-semibold ${battingTurn === 'first' ? 'bg-green-700 text-white border-green-700' : 'bg-white text-gray-700 border-gray-300'}`}
          >
            先攻
          </button>
          <button
            type="button"
            onClick={() => setBattingTurn('second')}
            className={`py-2 rounded-lg border-2 text-sm font-semibold ${battingTurn === 'second' ? 'bg-green-700 text-white border-green-700' : 'bg-white text-gray-700 border-gray-300'}`}
          >
            後攻
          </button>
        </div>

        <h2 className="font-semibold text-sm mb-1">スタメン・打順設定</h2>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-3 text-xs text-gray-600">
          ルール: スタメン再出場1回まで / テンポラリー: 2アウト時に投手・捕手の代走（打順1つ前の選手）
        </div>

        {players.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">先に選手を登録してください</p>
        ) : (
          <div className="border border-gray-200 rounded-xl overflow-hidden mb-4">
            <div className="grid grid-cols-12 bg-gray-50 px-3 py-2 text-xs text-gray-500 font-semibold">
              <div className="col-span-1">✓</div>
              <div className="col-span-5">選手</div>
              <div className="col-span-3">打順</div>
              <div className="col-span-3">守備</div>
            </div>
            {players.map((player, i) => {
              const l = lineup.find(l => l.playerId === player.id)
              return (
                <div key={player.id} className={`grid grid-cols-12 items-center px-3 py-2 text-sm ${i > 0 ? 'border-t border-gray-100' : ''} ${l?.isStarter ? 'bg-green-50' : ''}`}>
                  <div className="col-span-1">
                    <input type="checkbox" checked={l?.isStarter || false}
                      onChange={() => toggleStarter(player.id)}
                      className="w-4 h-4 accent-green-700" />
                  </div>
                  <div className="col-span-5">
                    <span className="font-semibold text-xs">#{player.number}</span>
                    <span className="ml-1 text-xs">{player.name}</span>
                  </div>
                  <div className="col-span-3">
                    {l?.isStarter && (
                      <input type="number" min="1" max="20" value={l?.battingOrder || ''}
                        onChange={e => setOrder(player.id, e.target.value)}
                        className="w-12 border border-gray-300 rounded px-1 py-1 text-xs" />
                    )}
                  </div>
                  <div className="col-span-3">
                    {l?.isStarter && (
                      <select value={l?.position || ''} onChange={e => setPosition(player.id, e.target.value)}
                        className="w-full border border-gray-300 rounded px-1 py-1 text-xs">
                        <option value="">-</option>
                        {positions.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <button onClick={createGame} disabled={saving}
          className="w-full bg-green-700 text-white font-semibold py-3 rounded-xl disabled:opacity-50">
          {saving ? '作成中...' : '試合を開始'}
        </button>
      </div>
    </div>
  )
}

export default function NewGamePage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><p className="text-gray-500">読み込み中...</p></div>}>
      <NewGameContent />
    </Suspense>
  )
}
