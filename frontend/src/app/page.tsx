'use client'
import Link from 'next/link'
import RentForm from './components/RentForm'
import { useRequireAuth, useAuth } from './context/AuthContext'
import { useRouter } from 'next/navigation'

export default function Home() {
  const { user, loading } = useRequireAuth()
  const { logout } = useAuth()
  const router = useRouter()

  const handleLogout = () => {
    logout()
    router.replace('/login')
  }

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fcfcfd]">
        <div className="w-6 h-6 rounded-full border-2 border-[#bb432c] border-t-transparent animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#fcfcfd] text-gray-900">
      {/* Navigation */}
      <header className="bg-white border-b border-gray-200/80 sticky top-0 z-50 shadow-xs">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2.5 text-decoration-none group">
              <svg className="w-7 h-7 transition-transform duration-300 group-hover:scale-105" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="32" height="32" rx="7" fill="#111827" />
                <path d="M8 8L16 16L8 24" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
                <path d="M14 8L22 16L14 24" stroke="#bb432c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="23.5" cy="16" r="2" fill="#bb432c" />
              </svg>
              <span className="font-bold text-lg tracking-tight text-gray-900">Kinetic</span>
            </Link>
          </div>

          <nav className="flex items-center gap-2 sm:gap-3 text-sm font-medium text-gray-600">
            <Link href="/" className="px-3 py-1.5 text-[#bb432c] border-b-2 border-[#bb432c] font-semibold">
              Rent GPU
            </Link>
            <Link href="/jupyter" className="px-3 py-1.5 hover:text-gray-900 transition-colors rounded hover:bg-gray-100/80">
              Workspace
            </Link>
            <Link href="/host" className="px-3 py-1.5 hover:text-gray-900 transition-colors rounded hover:bg-gray-100/80">
              Host a Node
            </Link>
            {user.is_admin && (
              <Link href="/admin" className="px-3 py-1.5 hover:text-gray-900 transition-colors rounded hover:bg-gray-100/80">
                Admin
              </Link>
            )}

            {/* User pill */}
            <div className="flex items-center gap-2 ml-2 pl-3 border-l border-gray-200">
              <div className="flex flex-col items-end">
                <span className="text-xs font-semibold text-gray-900 leading-tight">{user.email.split('@')[0]}</span>
                <span className="text-[10px] text-gray-400 leading-tight">
                  {user.max_vram_gb}GB · {user.max_cpu_cores}CPU · {user.max_ram_gb}GB RAM
                </span>
              </div>
              <button
                onClick={handleLogout}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
                title="Sign out"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
                </svg>
              </button>
            </div>
          </nav>
        </div>
      </header>

      {/* Active session banner */}
      {user.active_session && (
        <div className="bg-amber-50 border-b border-amber-200/80 px-4 py-2.5">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm text-amber-800">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
              <span className="font-medium">You have an active session</span>
              <span className="text-amber-600">· Status: {user.active_session.status}</span>
            </div>
            {user.active_session.jupyter_url && (
              <a
                href={user.active_session.jupyter_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-semibold text-amber-700 hover:text-amber-900 underline underline-offset-2"
              >
                Open Workspace →
              </a>
            )}
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8">
        <RentForm user={user} />
      </main>

      <footer className="border-t border-gray-200/80 bg-white py-6 mt-12 text-center text-xs text-gray-500">
        <div className="max-w-6xl mx-auto px-4 flex justify-center items-center gap-1.5">
          <span>Made with</span>
          <svg className="w-3.5 h-3.5 fill-[#bb432c] inline-block" viewBox="0 0 24 24">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
          </svg>
          <span>by IIITS</span>
        </div>
      </footer>
    </div>
  )
}
