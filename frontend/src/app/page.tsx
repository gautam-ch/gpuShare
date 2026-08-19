"use client"
import Link from 'next/link'
import RentForm from './components/RentForm'

export default function Home() {
  return (
    <main className="min-h-screen text-white p-6">
      <header className="border-b border-white/10 pb-4 mb-10 flex justify-between items-center">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
          GPU Share Hub
        </h1>
        <nav className="flex items-center gap-6">
          <Link href="/jupyter" className="text-sm hover:text-emerald-400 transition-colors">Jupyter Workspace</Link>
          <Link href="/host" className="text-sm hover:text-cyan-400 transition-colors">Host GPU</Link>
          <Link href="/admin" className="text-sm px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 hover:bg-indigo-500/20 rounded-lg transition-colors">Admin</Link>
        </nav>
      </header>
      <RentForm />
    </main>
  )
}
