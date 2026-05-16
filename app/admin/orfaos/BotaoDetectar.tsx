'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const TOAST_MS = 4000

export function BotaoDetectar() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  async function handleClick() {
    setLoading(true)
    setToast(null)
    try {
      const res = await fetch('/api/admin/orfaos/detectar', {
        method: 'POST',
      })
      if (!res.ok) {
        alert('Erro ao executar detecção.')
        return
      }
      const data = await res.json()
      const n = typeof data?.detectados === 'number' ? data.detectados : 0
      const msg =
        n === 0
          ? 'Nenhum novo órfão.'
          : n === 1
            ? '1 novo órfão detectado'
            : `${n} novos órfãos detectados`
      setToast(msg)
      router.refresh()
      setTimeout(() => setToast(null), TOAST_MS)
    } catch {
      alert('Erro de conexão.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {toast && (
        <div className="fixed top-4 right-4 z-50 px-4 py-2.5 bg-green-600 text-white text-sm font-medium rounded-md shadow-lg animate-in fade-in slide-in-from-top-2">
          ✓ {toast}
        </div>
      )}
      <button
        onClick={handleClick}
        disabled={loading}
        className="text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? 'Detectando…' : 'Detectar agora'}
      </button>
    </>
  )
}
