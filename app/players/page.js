'use client'

import { Suspense } from 'react'
import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { getClientSession, getUserTeam } from '@/lib/team-client'

function PlayersContent() {
  const searchParams = useSearchParams()
  const seasonId = searchParams.get('season')
  const teamIdParam = searchParams.get('team')
  const router = useRouter()

  const [players, setPlayers] = useState([])
  const [teamId, setTeamId] = useState(teamIdParam || null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editPlayer, setEditPlayer] = useState(null)
  const [form, setForm] = useState({ name: '', number: '', position: '' })
  const [errorMsg, setErrorMsg] = useState('')

  const positions = ['投手', '捕手', '一塁手', '二塁手', '三塁手', '遊撃手', '左翼手', '中堅手', '右翼手', 'DH']

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
      .order('number', { ascending: true })
    if (error) {
      setErrorMsg(error.message)
      setLoading(false)
      return
    }
    setPlayers(data || [])
    setLoading(false)
  }

  function openAdd() {
    setEditPlayer(null)
    setForm({ name: '', number: '', position: '' })
    setShowForm(true)
  }

  function openEdit(player) {
    setEditPlayer(player)
    setForm({ name: player.name, number: player.number || '', position: player.position || '' })
    setShowForm(true)
  }

  async function savePlayer() {
    if (!form.name.trim() || !teamId) return
    setErrorMsg('')
    if (editPlayer) {
      const { data, error } = await supabase
        .from('players')
        .update({ name: form.name.trim(), number: form.number.trim(), position: form.position })
        .eq('id', editPlayer.id)
        .eq('team_id', teamId)
        .select()
        .single()
      if (error) {
        setErrorMsg(error.message)
        return
      }
      setPlayers(players.map(p => p.id === editPlayer.id ? data : p))
    } else {
      const { data, error } = await supabase
        .from('players')
        .insert({
          season_id: seasonId,
          team_id: teamId,
          name: form.name.trim(),
          number: form.number.trim(),
          position: form.position
        })
        .select()
        .single()
      if (error) {
        setErrorMsg(error.message)
        return
      }
      setPlayers([...players, data])
    }
    setShowForm(false)
    setEditPlayer(null)
  }

  async function deletePlayer(id) {
    if (!confirm('この選手を削除しますか？')) return
    setErrorMsg('')
    const { error } = await supabase.from('players').delete().eq('id', id).eq('team_id', teamId)
    if (error) {
      setErrorMsg(error.message)
      return
    }
    setPlayers(players.filter(p => p.id !== id))
  }

  if (loading) return <div className="flex items-center justify-center min-h-screen"><p className="text-gray-500">読み込み中...</p></div>

  return (
    <div className="max-w-md mx-auto min-h-screen bg-white">
      <header className="bg-gradient-to-r from-green-900 to-green-700 text-white px-4 py-3 flex items-center justify-between">
        <h1 className="text-base font-semibold">👥 選手一覧</h1>
        <Link href={`/?season=${seasonId}&team=${teamId}`} className="text-xs text-green-200">← ホーム</Link>
      </header>

      <div className="p-4">
        {errorMsg && <p className="text-sm text-red-600 mb-3">{errorMsg}</p>}

        <button
          onClick={openAdd}
          className="w-full bg-green-700 text-white font-semibold py-3 rounded-xl mb-4"
        >
          ＋ 選手を追加
        </button>

        {/* フォーム */}
        {showForm && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-4">
            <h2 className="font-semibold text-sm mb-3">{editPlayer ? '選手を編集' : '新しい選手'}</h2>
            <label className="block text-xs text-gray-600 mb-1">名前 <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="例: 田中 太郎"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
            />
            <label className="block text-xs text-gray-600 mb-1">背番号</label>
            <input
              type="text"
              value={form.number}
              onChange={e => setForm({ ...form, number: e.target.value })}
              placeholder="例: 10"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
            />
            <label className="block text-xs text-gray-600 mb-1">ポジション</label>
            <select
              value={form.position}
              onChange={e => setForm({ ...form, position: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4"
            >
              <option value="">選択してください</option>
              {positions.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <div className="flex gap-2">
              <button
                onClick={savePlayer}
                className="flex-1 bg-green-700 text-white font-semibold py-2 rounded-lg text-sm"
              >
                保存
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm"
              >
                キャンセル
              </button>
            </div>
          </div>
        )}

        {/* 選手リスト */}
        {players.length === 0 ? (
          <p className="text-sm text-gray-400 text-center mt-8">選手が登録されていません</p>
        ) : (
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            {players.map((player, i) => (
              <div key={player.id} className={`flex items-center justify-between px-4 py-3 ${i > 0 ? 'border-t border-gray-100' : ''}`}>
                <div>
                  <span className="font-bold text-sm">#{player.number || '—'}</span>
                  <span className="ml-2 text-sm">{player.name}</span>
                  {player.position && <span className="ml-2 text-xs text-gray-500">({player.position})</span>}
                </div>
                <div className="flex gap-3">
                  <button onClick={() => openEdit(player)} className="text-xs text-green-700">編集</button>
                  <button onClick={() => deletePlayer(player.id)} className="text-xs text-red-400">削除</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function PlayersPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><p className="text-gray-500">読み込み中...</p></div>}>
      <PlayersContent />
    </Suspense>
  )
}
