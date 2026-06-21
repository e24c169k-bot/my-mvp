'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

export default function GamesPage() {
  const searchParams = useSearchParams()
  const seasonId = searchParams.get('season')
  const [games, setGames] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (seasonId) fetchGames()
  }, [seasonId])

  async function fetchGames() {
    const { data } = await supabase
      .from('games')
      .select('*')
      .eq('season_id', seasonId)
      .order('date', { ascending: false })
    setGames(data || [])
    setLoading(false)
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <p className="text-gray-500">読み込み中...</p>
    </div>
  )

  return (
    <div className="max-w-md mx-auto min-h-screen bg-white">
      <header className="bg-gradient-to-r from-green-900 to-green-700 text-white px-4 py-3 flex items-center justify-between">
        <h1 className="text-base font-semibold">📋 試合一覧</h1>
        <Link href={`/?season=${seasonId}`} className="text-xs text-green-200">← ホーム</Link>
      </header>

      <div className="p-4">
        <Link
          href={`/games/new?season=${seasonId}`}
          className="block w-full bg-green-700 text-white font-semibold py-3 rounded-xl mb-4 text-center"
        >
          ＋ 新規試合
        </Link>

        {games.length === 0 ? (
          <p className="text-sm text-gray-400 text-center mt-8">試合が登録されていません</p>
        ) : (
          <div className="flex flex-col gap-3">
            {games.map(game => (
              <div key={game.id} className="border border-gray-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="font-bold text-sm">vs {game.opponent}</span>
                    <span className={`ml-2 text-xs px-2 py-0.5 rounded-full font-semibold ${
                      game.status === 'active'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}>
                      {game.status === 'active' ? '進行中' : '終了'}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">{game.date}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">
                    {game.score_us} - {game.score_them}
                  </span>
                  <div className="flex gap-2">
                    {game.status === 'active' && (
                      <Link
                        href={`/games/${game.id}/record?season=${seasonId}`}
                        className="text-xs bg-green-700 text-white px-3 py-1.5 rounded-lg font-semibold"
                      >
                        記録
                      </Link>
                    )}
                    <Link
                      href={`/stats?season=${seasonId}&game=${game.id}`}
                      className="text-xs border border-green-700 text-green-700 px-3 py-1.5 rounded-lg font-semibold"
                    >
                      成績
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
