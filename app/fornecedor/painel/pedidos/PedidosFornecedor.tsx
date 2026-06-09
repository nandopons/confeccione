'use client'

import { useState } from 'react'
import Link from 'next/link'

type Oferta = {
  ofertaId: string
  pedidoId: string
  status: string
  repasseStatus: 'a_receber' | 'pago'
  valorRepasseCentavos: number | null
  criadoEm: string
  totalPecas: number
  resumo: string
  numImagens: number
}

function brl(c: number | null | undefined) {
  if (c == null) return '—'
  return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function data(s: string) {
  try { return new Date(s).toLocaleDateString('pt-BR') } catch { return s }
}

function Resumo({ texto }: { texto: string }) {
  return (
    <div className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">{texto}</div>
  )
}

export default function PedidosFornecedor({ pendentes, aceitos }: { pendentes: Oferta[]; aceitos: Oferta[] }) {
  const [tab, setTab] = useState<'pendentes' | 'aceitos'>('pendentes')
  const [lista, setLista] = useState({ pendentes, aceitos })
  const [agindo, setAgindo] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  async function responder(ofertaId: string, acao: 'aceitar' | 'recusar') {
    setAgindo(ofertaId)
    setErro(null)
    try {
      const r = await fetch(`/api/fornecedor/oferta/${ofertaId}/responder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro || 'Falha')
      // move da lista de pendentes
      setLista((prev) => {
        const alvo = prev.pendentes.find((o) => o.ofertaId === ofertaId)
        const pendentes = prev.pendentes.filter((o) => o.ofertaId !== ofertaId)
        const aceitos = acao === 'aceitar' && alvo ? [{ ...alvo, status: 'aceita' }, ...prev.aceitos] : prev.aceitos
        return { pendentes, aceitos }
      })
    } catch (e: any) {
      setErro(e.message || 'Erro')
    } finally {
      setAgindo(null)
    }
  }

  const itens = tab === 'pendentes' ? lista.pendentes : lista.aceitos

  return (
    <div>
      <div className="flex gap-2 mb-5">
        {(['pendentes', 'aceitos'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={'px-4 py-2 rounded-full text-sm font-medium ' + (tab === t ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600')}
          >
            {t === 'pendentes' ? `Pendentes (${lista.pendentes.length})` : `Aceitos (${lista.aceitos.length})`}
          </button>
        ))}
      </div>

      {erro && <div className="mb-4 text-sm rounded-md bg-red-50 text-red-700 px-3 py-2">{erro}</div>}

      {itens.length === 0 && (
        <div className="text-sm text-gray-400 py-10 text-center">
          {tab === 'pendentes' ? 'Nenhum pedido pendente no momento.' : 'Você ainda não assumiu nenhum pedido.'}
        </div>
      )}

      <div className="space-y-4">
        {itens.map((o) => (
          <div key={o.ofertaId} className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div>
                <div className="text-xs text-gray-400">{data(o.criadoEm)}</div>
                <div className="font-semibold text-gray-900">{o.totalPecas} peças · {brl(o.valorRepasseCentavos)}</div>
              </div>
              {tab === 'aceitos' && (
                <span className={'text-xs px-2 py-1 rounded-full ' + (o.repasseStatus === 'pago' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800')}>
                  {o.repasseStatus === 'pago' ? 'pago' : 'a receber'}
                </span>
              )}
            </div>
            <Resumo texto={o.resumo} />

            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href={`/fornecedor/oferta/${o.ofertaId}`}
                className="text-sm px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                Ver mockups e detalhes
              </Link>

              {tab === 'pendentes' && (
                <>
                  <button
                    onClick={() => responder(o.ofertaId, 'aceitar')}
                    disabled={agindo === o.ofertaId}
                    className="text-sm px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {agindo === o.ofertaId ? '...' : 'Assumir pedido'}
                  </button>
                  <button
                    onClick={() => responder(o.ofertaId, 'recusar')}
                    disabled={agindo === o.ofertaId}
                    className="text-sm px-3 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Recusar
                  </button>
                </>
              )}

              {tab === 'aceitos' && (
                <Link
                  href="/fornecedor/painel/envio"
                  className="text-sm px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  Envio (Melhor Envio)
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
