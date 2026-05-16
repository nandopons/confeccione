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
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white p-8 rounded-xl shadow-sm w-full max-w-sm"
      >
        <h1 className="text-xl font-bold text-gray-900 mb-1">
          Admin · Confeccione
        </h1>
        <p className="text-sm text-gray-500 mb-6">
          Acesso restrito.
        </p>

        <label
          htmlFor="password"
          className="block text-sm text-gray-600 mb-1.5"
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
          className="w-full px-3 py-2.5 text-base border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-60"
        />

        {erro && (
          <div className="mt-3 text-red-700 text-sm">{erro}</div>
        )}

        <button
          type="submit"
          disabled={loading || password.length === 0}
          className="mt-5 w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-md disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
