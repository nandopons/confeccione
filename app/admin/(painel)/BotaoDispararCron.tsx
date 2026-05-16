'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const TOAST_OK_MS = 4000
const TOAST_ERRO_MS = 6000

type Toast = { tipo: 'ok' | 'erro'; texto: string }

export function BotaoDispararCron() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)

  async function handleClick() {
    setLoading(true)
    setToast(null)
    try {
      const res = await fetch('/api/admin/cron-disparar', {
        method: 'POST',
      })
      const data = await res.json().catch(() => null)

      if (!res.ok) {
        const msg =
          typeof data?.erro === 'string'
            ? data.erro
            : `Falha (status ${res.status})`
        setToast({ tipo: 'erro', texto: msg })
        setTimeout(() => setToast(null), TOAST_ERRO_MS)
        return
      }

      const n = typeof data?.detectados === 'number' ? data.detectados : 0
      const dur = typeof data?.duracao_ms === 'number' ? data.duracao_ms : 0
      setToast({
        tipo: 'ok',
        texto: `Cron disparado · ${n} ${n === 1 ? 'órfão' : 'órfãos'} · ${dur}ms`,
      })
      router.refresh()
      setTimeout(() => setToast(null), TOAST_OK_MS)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro de conexão'
      setToast({ tipo: 'erro', texto: msg })
      setTimeout(() => setToast(null), TOAST_ERRO_MS)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {toast && (
        <div
          className={
            'fixed top-4 right-4 z-50 px-4 py-2.5 text-white text-sm font-medium rounded-md shadow-lg max-w-md ' +
            (toast.tipo === 'ok' ? 'bg-green-600' : 'bg-red-600')
          }
        >
          {toast.tipo === 'ok' ? '✓' : '⚠'} {toast.texto}
        </div>
      )}
      <button
        onClick={handleClick}
        disabled={loading}
        className="text-sm px-3 py-1.5 bg-white/80 hover:bg-white text-gray-900 font-medium rounded-md disabled:opacity-60 disabled:cursor-not-allowed transition-colors border border-gray-300 whitespace-nowrap"
      >
        {loading ? 'Disparando…' : 'Disparar cron'}
      </button>
    </>
  )
}
