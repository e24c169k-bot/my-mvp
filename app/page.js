'use client'

import { Suspense } from 'react'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { getClientSession, getUserTeam } from '@/lib/team-client'

function HomeContent() {
  const router = useRouter()
  const [seasons, setSeasons] = useState([])
  const [currentSeason, setCurrentSeason] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [newSeasonName, setNewSeasonName] = useState('')
  const [teamId, setTeamId] = useState(null)
  const [teamName, setTeamName] = useState('')
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    initialize()
  }, [])

  async function initialize() {
    setLoading(true)
    setErrorMsg('')

    const { user, sessionError } = await getClientSession()
    if (sessionError) {
      setErrorMsg(sessionError.message)
      setLoading(false)
      return
    }
    if (!user) {
      router.push('/auth')
      return
    }

    const { team, teamError } = await getUserTeam(user.id)
    if (teamError) {
      setErrorMsg(teamError.message)
      setLoading(false)
      return
    }
    if (!team?.team_id) {
      router.push('/onboarding')
      return
    }

    setTeamId(team.team_id)
    setTeamName(team.teams?.name || '')
    await fetchSeasons(team.team_id)
  }

  async function fetchSeasons(currentTeamId) {
    const { data, error } = await supabase
      .from('seasons')
      .select('*')
      .eq('team_id', currentTeamId)
      .order('created_at', { ascending: false })
    if (error) {
      setErrorMsg(error.message)
      setLoading(false)
      return
    }

    if (data && data.length > 0) {
      setSeasons(data)
      setCurrentSeason(data[0])
    }
    setLoading(false)
  }

  async function createSeason() {
    if (!newSeasonName.trim()) {
      setErrorMsg('シーズン名を入力してください')
      return
    }
    if (!teamId) {
      setErrorMsg('チーム情報の読み込みに失敗しました。再読み込みしてください。')
      return
    }
    setErrorMsg('')
    const { data, error } = await supabase
      .from('seasons')
      .insert({
        name: newSeasonName.trim(),
        team_id: teamId
      })
      .select()
      .single()
    if (error) {
      setErrorMsg(error.message)
      return
    }
    if (data) {
      setCurrentSeason(data)
      setSeasons([data, ...seasons])
      setNewSeasonName('')
      setShowForm(false)
    }
  }

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/auth')
    router.refresh()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">読み込み中...</p>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto min-h-screen bg-white">
      {/* ヘッダー */}
      <header className="bg-gradient-to-r from-green-900 to-green-700 text-white px-4 py-3 flex items-center justify-between">
        <h1 className="text-base font-semibold">⚾ ソフトボール成績記録</h1>
        <button onClick={signOut} className="text-xs text-green-100 underline">ログアウト</button>
      </header>

      <div className="p-4">
        {errorMsg && (
          <p className="text-sm text-red-600 mb-3">{errorMsg}</p>
        )}

        {/* シーズン表示 */}
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-4">
          <p className="text-xs text-gray-500 mb-1">現在のシーズン</p>
          <p className="text-xs text-gray-500 mb-2">チーム: {teamName || '—'}</p>
          {currentSeason ? (
            <div className="flex items-center justify-between">
              <p className="text-xl font-bold text-green-900">{currentSeason.name}</p>
              <select
                className="text-xs border border-gray-300 rounded px-2 py-1"
                value={currentSeason.id}
                onChange={(e) => {
                  const s = seasons.find(s => s.id === e.target.value)
                  if (s) setCurrentSeason(s)
                }}
              >
                {seasons.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          ) : (
            <p className="text-sm text-gray-400">シーズンがありません</p>
          )}
          <button
            onClick={() => setShowForm(!showForm)}
            className="mt-2 text-xs text-green-700 underline"
          >
            ＋ 新しいシーズンを追加
          </button>
          {showForm && (
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={newSeasonName}
                onChange={(e) => setNewSeasonName(e.target.value)}
                placeholder="例: 2026年春季リーグ"
                className="flex-1 text-sm border border-gray-300 rounded px-3 py-2"
                onKeyDown={(e) => e.key === 'Enter' && createSeason()}
              />
              <button
                onClick={createSeason}
                disabled={!teamId}
                className="bg-green-700 text-white text-sm px-3 py-2 rounded font-semibold"
              >
                追加
              </button>
            </div>
          )}
        </div>

        {/* メニュー */}
        {currentSeason ? (
          <div className="flex flex-col gap-3">
            <Link
              href={`/players?season=${currentSeason.id}&team=${teamId}`}
              className="block bg-white border border-gray-200 rounded-xl p-4 hover:bg-green-50 transition-colors"
            >
              <p className="font-semibold text-base">👥 選手管理</p>
              <p className="text-sm text-gray-500 mt-1">登録・編集</p>
            </Link>
            <Link
              href={`/games?season=${currentSeason.id}&team=${teamId}`}
              className="block bg-white border border-gray-200 rounded-xl p-4 hover:bg-green-50 transition-colors"
            >
              <p className="font-semibold text-base">📋 試合管理</p>
              <p className="text-sm text-gray-500 mt-1">試合一覧・新規作成</p>
            </Link>
            <Link
              href={`/stats?season=${currentSeason.id}&team=${teamId}`}
              className="block bg-white border border-gray-200 rounded-xl p-4 hover:bg-green-50 transition-colors"
            >
              <p className="font-semibold text-base">📊 成績一覧</p>
              <p className="text-sm text-gray-500 mt-1">シーズン通算・CSV出力</p>
            </Link>
          </div>
        ) : (
          <p className="text-sm text-gray-400 text-center mt-8">
            まずシーズンを追加してください
          </p>
        )}
      </div>
    </div>
  )
}

export default function Home() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><p className="text-gray-500">読み込み中...</p></div>}>
      <HomeContent />
    </Suspense>
  )
}
