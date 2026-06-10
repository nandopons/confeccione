'use client'

import { useState, useEffect, type FormEvent } from 'react'

export default function AdminLoginPage() {
  const [password, setPassword] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [proximo, setProximo] = useState('/admin/orfaos')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const p = params.get('proximo')
    // Anti-open-redirect: só aceita rotas /admin/* internas. A barra
    // depois de /admin é importante — evita casar com /admins-fake
    // ou /admin@evil.com caso surjam rotas legítimas no futuro.
    if (p && p.startsWith('/admin/')) setProximo(p)
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    setLoading(true)

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      if (res.ok) {
        window.location.href = proximo
        return
      }

      if (res.status === 401) {
        setErro('Senha inválida.')
      } else {
        setErro('Erro ao processar. Tenta de novo.')
      }
    } catch {
      setErro('Erro de conexão.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0E1814] px-4 [background-image:radial-gradient(ellipse_at_top,rgba(29,158,117,0.14),transparent_55%)]">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2.5 mb-6">
          <svg width="30" height="30" viewBox="0 0 60 60" fill="none" aria-hidden>
            <path d="M30 6 A24 24 0 0 1 54 30" stroke="#1D9E75" strokeWidth="10" strokeLinecap="round" />
            <path d="M54 30 A24 24 0 0 1 30 54" stroke="white" strokeWidth="10" strokeLinecap="round" opacity="0.45" />
            <path d="M30 54 A24 24 0 0 1 6 30" stroke="white" strokeWidth="10" strokeLinecap="round" opacity="0.7" />
            <path d="M6 30 A24 24 0 0 1 30 6" stroke="white" strokeWidth="10" strokeLinecap="round" opacity="0.3" />
            <circle cx="30" cy="30" r="5" fill="white" />
          </svg>
          <span className="text-white font-semibold tracking-[0.16em] text-sm">
            CONFECCIONE
          </span>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white p-8 rounded-2xl shadow-[0_20px_60px_-20px_rgba(0,0,0,0.6)] w-full"
        >
          <h1 className="text-lg font-bold text-gray-900 mb-1">
            Painel administrativo
          </h1>
          <p className="text-sm text-gray-500 mb-6">Acesso restrito.</p>

          <label
            htmlFor="password"
            className="block text-sm font-medium text-gray-600 mb-1.5"
          >
            Senha
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            autoComplete="current-password"
            disabled={loading}
            className="w-full px-3 py-2.5 text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D9E75] focus:border-transparent disabled:opacity-60"
          />

          {erro && (
            <div className="mt-3 text-red-700 text-sm">{erro}</div>
          )}

          <button
            type="submit"
            disabled={loading || password.length === 0}
            className="mt-5 w-full py-2.5 bg-[#1D9E75] hover:bg-[#178A65] text-white font-semibold rounded-lg disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <p className="text-center text-[11px] text-white/30 mt-5">
          confeccione.com.br
        </p>
      </div>
    </div>
  )
}
