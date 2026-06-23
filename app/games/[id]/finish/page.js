'use client'

import { Suspense } from 'react'
import { useEffect, useState } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { getClientSession, getUserTeam } from '@/lib/team-client'

function FinishContent() {
  const { id: gameId } = useParams()
  const searchParams = useSearchParams()
  const seasonId = searchParams.get('season')
  const teamIdParam = searchParams.get('team')
  const router = useRouter()

  const [teamId, setTeamId] = useState(teamIdParam || null)
  const [game, setGame] = useState(null)
  const [loading, setLoading] = useState(true)
  const [calculating, setCalculating] = useState(false)
  const [done, setDone] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    initialize()
  }, [gameId, teamIdParam])

  async function initialize() {
    setLoading(true)
    setErrorMsg('')

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

    const { data, error } = await supabase
      .from('games')
      .select('*')
      .eq('id', gameId)
      .eq('team_id', team.team_id)
      .single()
    if (error) {
      setErrorMsg(error.message)
      setLoading(false)
      return
    }
    setGame(data)
    setLoading(false)
  }

  async function calcStats() {
    if (!teamId) return
    setCalculating(true)
    setErrorMsg('')

    const { error } = await supabase.rpc('calc_game_stats', {
      p_game_id: gameId,
      p_team_id: teamId
    })
    if (error) {
      setErrorMsg(error.message)
      setCalculating(false)
      return
    }
    setDone(true)
    setCalculating(false)
  }

  if (loading) return <div className="flex items-center justify-center min-h-screen"><p className="text-gray-500">読み込み中...</p></div>

  return (
    <div className="max-w-md mx-auto min-h-screen bg-white">
      <header className="bg-gradient-to-r from-green-900 to-green-700 text-white px-4 py-3 flex items-center justify-between">
        <h1 className="text-base font-semibold">試合終了</h1>
        <Link href={`/games/${gameId}/record?season=${seasonId}&team=${teamId}`} className="text-xs text-green-200">← 記録に戻る</Link>
      </header>

      <div className="p-4">
        {errorMsg && <p className="text-sm text-red-600 mb-3">{errorMsg}</p>}

        <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6">
          <p className="text-xs text-gray-500 mb-1">試合</p>
          <p className="font-bold text-base">vs {game?.opponent} — {game?.date}</p>
          <p className="text-3xl font-bold text-center mt-3 mb-1">{game?.score_us} - {game?.score_them}</p>
        </div>

        {!done ? (
          <>
            <p className="text-sm text-gray-600 mb-6">試合を終了すると、記録データから打撃・投球成績を自動計算します。</p>
            <button onClick={calcStats} disabled={calculating} className="w-full bg-green-700 text-white font-bold py-4 rounded-xl text-base disabled:opacity-50">
              {calculating ? '計算中...' : '成績を計算して試合を終了'}
            </button>
            <Link href={`/games/${gameId}/record?season=${seasonId}&team=${teamId}`} className="block w-full text-center mt-3 py-3 border-2 border-gray-300 rounded-xl text-sm text-gray-600">記録に戻る</Link>
          </>
        ) : (
          <>
            <div className="bg-green-100 border border-green-300 rounded-xl p-4 mb-6 text-center">
              <p className="text-2xl mb-2">完了</p>
              <p className="font-bold text-green-800">成績を計算しました</p>
            </div>
            <Link href={`/stats?season=${seasonId}&team=${teamId}`} className="block w-full text-center bg-green-700 text-white font-bold py-4 rounded-xl text-base">成績一覧を見る</Link>
            <Link href={`/games?season=${seasonId}&team=${teamId}`} className="block w-full text-center mt-3 py-3 border-2 border-gray-300 rounded-xl text-sm text-gray-600">試合一覧に戻る</Link>
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
