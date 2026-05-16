'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { StatusOrfao } from '@/app/lib/orfaos'

type BotaoAcao = {
  label: string
  destino: StatusOrfao
  classe: string
}

function botoesPraStatus(atual: StatusOrfao): BotaoAcao[] {
  switch (atual) {
    case 'aberto':
      return [
        { label: 'Em captação', destino: 'em_captacao', classe: 'bg-yellow-600 hover:bg-yellow-700' },
        { label: 'Resolvido', destino: 'resolvido', classe: 'bg-green-600 hover:bg-green-700' },
        { label: 'Descartar', destino: 'descartado', classe: 'bg-gray-500 hover:bg-gray-600' },
      ]
    case 'em_captacao':
      return [
        { label: 'Resolvido', destino: 'resolvido', classe: 'bg-green-600 hover:bg-green-700' },
        { label: 'Descartar', destino: 'descartado', classe: 'bg-gray-500 hover:bg-gray-600' },
      ]
    case 'resolvido':
    case 'descartado':
      return [
        { label: 'Reabrir', destino: 'aberto', classe: 'bg-blue-600 hover:bg-blue-700' },
      ]
  }
}

export function AcoesOrfao({
  orfaoId,
  statusAtual,
}: {
  orfaoId: string
  statusAtual: StatusOrfao
}) {
  const router = useRouter()
  const [loading, setLoading] = useState<StatusOrfao | null>(null)

  async function mudarStatus(destino: StatusOrfao) {
    setLoading(destino)
    try {
      const res = await fetch('/api/admin/orfaos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orfao_id: orfaoId, novo_status: destino }),
      })
      if (res.status === 409) {
        alert('Esse órfão foi atualizado em outro lugar. Recarregando…')
        router.refresh()
        return
      }
      if (!res.ok) {
        alert('Erro ao atualizar status.')
        return
      }
      router.refresh()
    } catch {
      alert('Erro de conexão.')
    } finally {
      setLoading(null)
    }
  }

  const botoes = botoesPraStatus(statusAtual)

  return (
    <div className="flex gap-1 flex-wrap">
      {botoes.map((b) => (
        <button
          key={b.destino}
          onClick={() => mudarStatus(b.destino)}
          disabled={loading !== null}
          className={`text-xs px-2 py-1 text-white rounded ${b.classe} disabled:opacity-50 disabled:cursor-not-allowed transition-colors`}
        >
          {loading === b.destino ? '…' : b.label}
        </button>
      ))}
    </div>
  )
}
