'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../context/AuthContext'

export default function LoginPage() {
  const { login, user, loading } = useAuth()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // If already logged in, go home
  useEffect(() => {
    if (!loading && user) router.replace('/')
  }, [user, loading, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await login(email, password)
      router.replace('/')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fcfcfd]">
        <div className="w-6 h-6 rounded-full border-2 border-[#bb432c] border-t-transparent animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#fcfcfd] px-4">
      {/* Logo */}
      <div className="flex items-center gap-2.5 mb-8">
        <svg className="w-9 h-9" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="32" height="32" rx="7" fill="#111827" />
          <path d="M8 8L16 16L8 24" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
          <path d="M14 8L22 16L14 24" stroke="#bb432c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="23.5" cy="16" r="2" fill="#bb432c" />
        </svg>
        <span className="font-bold text-2xl tracking-tight text-gray-900">Kinetic</span>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm bg-white border border-gray-200/80 rounded-2xl shadow-sm p-8 space-y-6">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-gray-900">Sign in to your cluster</h1>
          <p className="text-sm text-gray-500">Enter your credentials to access the GPU compute pool.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3.5 py-2.5 text-sm border border-gray-200 rounded-lg bg-gray-50 text-gray-900 placeholder-gray-400
                         focus:outline-none focus:ring-2 focus:ring-[#bb432c]/30 focus:border-[#bb432c] transition"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3.5 py-2.5 text-sm border border-gray-200 rounded-lg bg-gray-50 text-gray-900 placeholder-gray-400
                         focus:outline-none focus:ring-2 focus:ring-[#bb432c]/30 focus:border-[#bb432c] transition"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 px-3.5 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 px-4 bg-[#bb432c] hover:bg-[#a33a25] text-white text-sm font-semibold rounded-lg
                       transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                Signing in…
              </>
            ) : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400">
          Contact your cluster administrator to get access.
        </p>
      </div>

      <p className="mt-8 text-xs text-gray-400">Kinetic GPU Cluster · Private Access</p>
    </div>
  )
}
