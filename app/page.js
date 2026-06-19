'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

export default function Home() {
  const [seasons, setSeasons] = useState([])
  const [currentSeason, setCurrentSeason] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [newSeasonName, setNewSeasonName] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchSeasons()
  }, [])

  async function fetchSeasons() {
    const { data } = await supabase
      .from('seasons')
      .select('*')
      .order('created_at', { ascending: false })
    if (data && data.length > 0) {
      setSeasons(data)
      setCurrentSeason(data[0])
    }
    setLoading(false)
  }

  async function createSeason() {
    if (!newSeasonName.trim()) return
    const { data } = await supabase
      .from('seasons')
      .insert({ name: newSeasonName.trim() })
      .select()
      .single()
    if (data) {
      setCurrentSeason(data)
      setSeasons([data, ...seasons])
      setNewSeasonName('')
      setShowForm(false)
    }
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
      <header className="bg-gradient-to-r from-green-900 to-green-700 text-white px-4 py-3">
        <h1 className="text-base font-semibold">⚾ ソフトボール成績記録</h1>
      </header>

      <div className="p-4">
        {/* シーズン表示 */}
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-4">
          <p className="text-xs text-gray-500 mb-1">現在のシーズン</p>
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
              href={`/players?season=${currentSeason.id}`}
              className="block bg-white border border-gray-200 rounded-xl p-4 hover:bg-green-50 transition-colors"
            >
              <p className="font-semibold text-base">👥 選手管理</p>
              <p className="text-sm text-gray-500 mt-1">登録・編集</p>
            </Link>
            <Link
              href={`/games?season=${currentSeason.id}`}
              className="block bg-white border border-gray-200 rounded-xl p-4 hover:bg-green-50 transition-colors"
            >
              <p className="font-semibold text-base">📋 試合管理</p>
              <p className="text-sm text-gray-500 mt-1">試合一覧・新規作成</p>
            </Link>
            <Link
              href={`/stats?season=${currentSeason.id}`}
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
