'use client'

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { useRouter } from 'next/navigation'

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'

export interface UserQuota {
  id: string
  email: string
  is_admin: boolean
  max_vram_gb: number
  max_cpu_cores: number
  max_ram_gb: number
  active_session: {
    job_id: number
    status: string
    jupyter_url: string | null
    machine_id: string
    started_at: string | null
  } | null
}

interface AuthState {
  user: UserQuota | null
  token: string | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserQuota | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchMe = useCallback(async (jwt: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${jwt}` },
      })
      if (!res.ok) throw new Error('Unauthorized')
      const data = await res.json()
      setUser(data)
    } catch {
      // Token invalid — clear
      localStorage.removeItem('kinetic_token')
      setToken(null)
      setUser(null)
    }
  }, [])

  // Restore session from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('kinetic_token')
    if (saved) {
      setToken(saved)
      fetchMe(saved).finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [fetchMe])

  const login = async (email: string, password: string) => {
    const res = await fetch(`${BACKEND_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.detail || 'Login failed')
    }
    const data = await res.json()
    localStorage.setItem('kinetic_token', data.access_token)
    setToken(data.access_token)
    setUser(data.user)
  }

  const logout = () => {
    localStorage.removeItem('kinetic_token')
    setToken(null)
    setUser(null)
  }

  const refreshUser = async () => {
    const jwt = localStorage.getItem('kinetic_token')
    if (jwt) await fetchMe(jwt)
  }

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

/** HOC: redirects to /login if not authenticated */
export function useRequireAuth() {
  const { user, loading } = useAuth()
  const router = useRouter()
  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [user, loading, router])
  return { user, loading }
}

/** HOC: redirects to / if not admin */
export function useRequireAdmin() {
  const { user, loading } = useAuth()
  const router = useRouter()
  useEffect(() => {
    if (!loading && !user) router.replace('/login')
    if (!loading && user && !user.is_admin) router.replace('/')
  }, [user, loading, router])
  return { user, loading }
}
