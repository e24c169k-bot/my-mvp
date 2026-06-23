'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function AuthPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  async function signUp() {
    setErrorMsg('')
    setLoading(true)
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) {
      setErrorMsg(error.message)
      setLoading(false)
      return
    }
    setLoading(false)
    router.push('/onboarding')
  }

  async function signIn() {
    setErrorMsg('')
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setErrorMsg(error.message)
      setLoading(false)
      return
    }
    setLoading(false)
    router.push('/')
    router.refresh()
  }

  return (
    <div className="max-w-md mx-auto min-h-screen bg-white p-4">
      <h1 className="text-xl font-bold mt-8 mb-6">ログイン</h1>
      <label className="block text-sm mb-1">メールアドレス</label>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 mb-3"
      />
      <label className="block text-sm mb-1">パスワード</label>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 mb-4"
      />

      {errorMsg && <p className="text-sm text-red-600 mb-3">{errorMsg}</p>}

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={signIn}
          disabled={loading}
          className="bg-green-700 text-white rounded-lg py-2 font-semibold disabled:opacity-50"
        >
          ログイン
        </button>
        <button
          onClick={signUp}
          disabled={loading}
          className="border border-green-700 text-green-700 rounded-lg py-2 font-semibold disabled:opacity-50"
        >
          新規登録
        </button>
      </div>
    </div>
  )
}
