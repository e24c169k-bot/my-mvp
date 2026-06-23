'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function OnboardingPage() {
  const router = useRouter()
  const [teamName, setTeamName] = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    checkMembership()
  }, [])

  async function checkMembership() {
    const { data: authData } = await supabase.auth.getUser()
    const user = authData?.user
    if (!user) {
      router.push('/auth')
      return
    }

    const { data: member } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle()

    if (member?.team_id) {
      router.push('/')
      return
    }
    setChecking(false)
  }

  async function createTeam() {
    if (!teamName.trim()) return
    setLoading(true)
    setErrorMsg('')

    const { data: authData, error: authError } = await supabase.auth.getUser()
    const user = authData?.user
    if (authError || !user) {
      setErrorMsg('ユーザー情報の取得に失敗しました')
      setLoading(false)
      return
    }

    const { data: team, error: teamError } = await supabase
      .from('teams')
      .insert({
        name: teamName.trim(),
        created_by: user.id
      })
      .select('id')
      .single()

    if (teamError || !team) {
      setErrorMsg(teamError?.message || 'チーム作成に失敗しました')
      setLoading(false)
      return
    }

    const { error: memberError } = await supabase.from('team_members').insert({
      team_id: team.id,
      user_id: user.id,
      role: 'owner'
    })

    if (memberError) {
      setErrorMsg(memberError.message)
      setLoading(false)
      return
    }

    setLoading(false)
    router.push('/')
    router.refresh()
  }

  if (checking) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">確認中...</p>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto min-h-screen bg-white p-4">
      <h1 className="text-xl font-bold mt-8 mb-2">チーム作成</h1>
      <p className="text-sm text-gray-600 mb-4">
        最初に所属チームを作成してください。以降のデータはチームごとに分離されます。
      </p>
      <input
        type="text"
        value={teamName}
        onChange={(e) => setTeamName(e.target.value)}
        placeholder="例: 〇〇ソフトボールクラブ"
        className="w-full border border-gray-300 rounded-lg px-3 py-2 mb-3"
      />
      {errorMsg && <p className="text-sm text-red-600 mb-2">{errorMsg}</p>}
      <button
        onClick={createTeam}
        disabled={loading}
        className="w-full bg-green-700 text-white rounded-lg py-2 font-semibold disabled:opacity-50"
      >
        {loading ? '作成中...' : 'チームを作成'}
      </button>
    </div>
  )
}
