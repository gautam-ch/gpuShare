"use client"
import Link from 'next/link'
import RentForm from './components/RentForm'

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col bg-[#f8f9fa] text-gray-900">
      {/* JupyterHub Style Top Navigation Bar */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex justify-between items-center">
          <div className="flex items-center gap-3">
            {/* Jupyter Iconic Logo Marks */}
            <div className="flex items-center gap-2">
              <svg className="w-7 h-7" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="22" cy="7" r="4" fill="#616161" />
                <path d="M7.5 22C7.5 13.9919 13.9919 7.5 22 7.5C22.68 7.5 23.3448 7.54707 23.9942 7.63821C16.9209 8.63185 11.5 14.6806 11.5 22C11.5 29.3194 16.9209 35.3681 23.9942 36.3618C23.3448 36.4529 22.68 36.5 22 36.5C13.9919 36.5 7.5 30.0081 7.5 22Z" fill="#F37626" />
                <circle cx="22" cy="37" r="4" fill="#616161" />
                <circle cx="34" cy="14" r="3.5" fill="#616161" />
                <circle cx="10" cy="30" r="3" fill="#616161" />
              </svg>
              <div className="flex flex-col">
                <span className="font-bold text-base tracking-tight text-gray-900 leading-tight flex items-center gap-1.5">
                  JupyterHub <span className="text-xs font-semibold px-1.5 py-0.5 bg-orange-100 text-orange-800 rounded border border-orange-200">GPU Cluster</span>
                </span>
              </div>
            </div>
          </div>

          <nav className="flex items-center gap-1 sm:gap-4 text-sm font-medium text-gray-600">
            <Link 
              href="/" 
              className="px-3 py-1.5 text-orange-600 border-b-2 border-orange-500 font-semibold"
            >
              Spawner / Rent
            </Link>
            <Link 
              href="/jupyter" 
              className="px-3 py-1.5 hover:text-gray-900 transition-colors rounded hover:bg-gray-100"
            >
              Workspace
            </Link>
            <Link 
              href="/host" 
              className="px-3 py-1.5 hover:text-gray-900 transition-colors rounded hover:bg-gray-100"
            >
              Host a Node
            </Link>
            <Link 
              href="/admin" 
              className="px-3 py-1.5 hover:text-gray-900 transition-colors rounded hover:bg-gray-100"
            >
              Admin
            </Link>
          </nav>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8">
        <RentForm />
      </main>

      {/* JupyterHub Clean Footer */}
      <footer className="border-t border-gray-200 bg-white py-6 mt-12 text-center text-xs text-gray-500">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row justify-between items-center gap-2">
          <div>
            Powered by <strong>Project Jupyter</strong> & Tailnet GPU Mesh
          </div>
          <div className="flex gap-4">
            <Link href="/jupyter" className="hover:text-gray-900 transition">JupyterLab</Link>
            <Link href="/host" className="hover:text-gray-900 transition">Provider Agent</Link>
            <Link href="/admin" className="hover:text-gray-900 transition">Hub Control Panel</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
