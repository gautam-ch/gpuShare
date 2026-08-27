"use client"
import Link from 'next/link'
import RentForm from './components/RentForm'

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col bg-[#fcfcfd] text-gray-900">
      {/* Clean Top Navigation Bar */}
      <header className="bg-white border-b border-gray-200/80 sticky top-0 z-50 shadow-xs">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2.5 text-decoration-none group">
              {/* Unique Kinetic Dynamic Symbol */}
              <svg className="w-7 h-7 transition-transform duration-300 group-hover:scale-105" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="32" height="32" rx="7" fill="#111827" />
                {/* Dynamic forward energy rays */}
                <path d="M8 8L16 16L8 24" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
                <path d="M14 8L22 16L14 24" stroke="#bb432c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="23.5" cy="16" r="2" fill="#bb432c" />
              </svg>
              <span className="font-bold text-lg tracking-tight text-gray-900">
                Kinetic
              </span>
            </Link>
          </div>

          <nav className="flex items-center gap-2 sm:gap-4 text-sm font-medium text-gray-600">
            <Link 
              href="/" 
              className="px-3 py-1.5 text-[#bb432c] border-b-2 border-[#bb432c] font-semibold"
            >
              Rent GPU
            </Link>
            <Link 
              href="/jupyter" 
              className="px-3 py-1.5 hover:text-gray-900 transition-colors rounded hover:bg-gray-100/80"
            >
              Workspace
            </Link>
            <Link 
              href="/host" 
              className="px-3 py-1.5 hover:text-gray-900 transition-colors rounded hover:bg-gray-100/80"
            >
              Host a Node
            </Link>
          </nav>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8">
        <RentForm />
      </main>

      {/* Clean Footer */}
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

