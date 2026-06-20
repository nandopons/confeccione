'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'

type Estado = 'orcar' | 'aguardando_cliente' | 'producao' | 'concluido'

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
  pagamentoStatus: string | null
  orcamentoStatus: string | null
  prazoDias: number | null
  clienteNome: string | null
  estado: Estado
}

function brl(c: number | null | undefined) {
  if (c == null) return '—'
  return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function data(s: string) {
  try {
    return new Date(s).toLocaleDateString('pt-BR')
  } catch {
    return s
  }
}

function Resumo({ texto }: { texto: string }) {
  return <div className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">{texto}</div>
}

const VERDE = '#1D9E75'
const VERDE_ESCURO = '#0F6E56'
const VERDE_CLARO = '#E1F5EE'

type TabId = 'pendentes' | 'orcar' | 'aguardando_cliente' | 'producao' | 'concluido'

const TABS: { id: TabId; label: string; sempreVisivel: boolean }[] = [
  { id: 'pendentes', label: 'Pendentes', sempreVisivel: true },
  { id: 'orcar', label: 'A orçar', sempreVisivel: false },
  { id: 'aguardando_cliente', label: 'Aguardando cliente', sempreVisivel: false },
  { id: 'producao', label: 'Em produção', sempreVisivel: true },
  { id: 'concluido', label: 'Concluídos', sempreVisivel: false },
]

// Pílula de status + orientação por estado.
type EstadoCfg = {
  pill: string
  pillClass: string
  guidance: string
}
const ESTADO_CFG: Record<Estado, EstadoCfg> = {
  orcar: {
    pill: 'Defina o orçamento',
    pillClass: 'bg-amber-100 text-amber-800',
    guidance: 'Envie seu orçamento final pro cliente.',
  },
  aguardando_cliente: {
    pill: 'Aguardando o cliente pagar',
    pillClass: 'bg-amber-100 text-amber-800',
    guidance: 'Não inicie a produção ainda — só comece quando o pagamento for confirmado.',
  },
  producao: {
    pill: 'Pago — pode produzir ✓',
    pillClass: 'bg-green-100 text-green-800',
    guidance: 'Pagamento confirmado. Pode iniciar a produção.',
  },
  concluido: {
    pill: 'Repasse recebido',
    pillClass: 'bg-gray-100 text-gray-600',
    guidance: 'Confeccione já repassou o valor deste pedido.',
  },
}

function ValorLabel({ o }: { o: Oferta }) {
  if (o.estado === 'orcar') {
    return <span className="text-sm text-gray-400">Orçamento: a definir</span>
  }
  if (o.estado === 'aguardando_cliente') {
    return (
      <span className="text-sm text-gray-600">
        Orçamento enviado: <span className="font-semibold text-gray-900">{brl(o.valorRepasseCentavos)}</span>
      </span>
    )
  }
  if (o.estado === 'producao') {
    return (
      <span className="text-sm" style={{ color: VERDE_ESCURO }}>
        A receber: <span className="font-semibold">{brl(o.valorRepasseCentavos)}</span>
      </span>
    )
  }
  // concluido
  return (
    <span className="text-sm text-gray-600">
      Recebido: <span className="font-semibold text-gray-900">{brl(o.valorRepasseCentavos)}</span>
    </span>
  )
}

export default function PedidosFornecedor({ pendentes, aceitos }: { pendentes: Oferta[]; aceitos: Oferta[] }) {
  const [tab, setTab] = useState<TabId>('pendentes')
  const [lista, setLista] = useState({ pendentes, aceitos })
  const [agindo, setAgindo] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const grupos = useMemo(() => {
    const g: Record<Estado, Oferta[]> = { orcar: [], aguardando_cliente: [], producao: [], concluido: [] }
    for (const o of lista.aceitos) g[o.estado].push(o)
    return g
  }, [lista.aceitos])

  const counts: Record<TabId, number> = {
    pendentes: lista.pendentes.length,
    orcar: grupos.orcar.length,
    aguardando_cliente: grupos.aguardando_cliente.length,
    producao: grupos.producao.length,
    concluido: grupos.concluido.length,
  }

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
      setLista((prev) => {
        const alvo = prev.pendentes.find((o) => o.ofertaId === ofertaId)
        const pendentes = prev.pendentes.filter((o) => o.ofertaId !== ofertaId)
        const aceitos =
          acao === 'aceitar' && alvo
            ? [{ ...alvo, status: 'aceita', estado: 'orcar' as Estado }, ...prev.aceitos]
            : prev.aceitos
        return { pendentes, aceitos }
      })
      if (acao === 'aceitar') setTab('orcar')
    } catch (e: any) {
      setErro(e.message || 'Erro')
    } finally {
      setAgindo(null)
    }
  }

  const visiveis = TABS.filter((t) => t.sempreVisivel || counts[t.id] > 0)

  const itens: Oferta[] =
    tab === 'pendentes' ? lista.pendentes : grupos[tab as Estado] ?? []

  const vazioMsg: Record<TabId, string> = {
    pendentes: 'Nenhum pedido pendente no momento.',
    orcar: 'Nenhum pedido aguardando orçamento.',
    aguardando_cliente: 'Nenhum pedido aguardando pagamento do cliente.',
    producao: 'Nenhum pedido liberado para produção ainda.',
    concluido: 'Nenhum repasse concluído ainda.',
  }

  return (
    <div>
      {/* Tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {visiveis.map((t) => {
          const ativo = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={
                'px-4 py-2 rounded-full text-sm font-medium transition-colors ' +
                (ativo ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')
              }
              style={ativo ? { backgroundColor: VERDE_ESCURO } : undefined}
            >
              {t.label} ({counts[t.id]})
            </button>
          )
        })}
      </div>

      {erro && <div className="mb-4 text-sm rounded-md bg-red-50 text-red-700 px-3 py-2">{erro}</div>}

      {itens.length === 0 && (
        <div className="text-sm text-gray-400 py-12 text-center rounded-2xl border border-dashed border-gray-200">
          {vazioMsg[tab]}
        </div>
      )}

      <div className="space-y-4">
        {itens.map((o) =>
          tab === 'pendentes' ? (
            <CardPendente key={o.ofertaId} o={o} agindo={agindo === o.ofertaId} onResponder={responder} />
          ) : (
            <CardAceito key={o.ofertaId} o={o} />
          ),
        )}
      </div>
    </div>
  )
}

function CardPendente({
  o,
  agindo,
  onResponder,
}: {
  o: Oferta
  agindo: boolean
  onResponder: (ofertaId: string, acao: 'aceitar' | 'recusar') => void
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-xs text-gray-400">{data(o.criadoEm)}</div>
          <div className="font-semibold text-gray-900">
            {o.totalPecas} peças
            {o.clienteNome ? <span className="text-gray-400 font-normal"> · {o.clienteNome}</span> : null}
          </div>
        </div>
        <span className="text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-800">Nova oferta</span>
      </div>

      <Resumo texto={o.resumo} />

      <div className="mt-3 text-xs text-gray-500">Aceite para assumir este pedido e definir o orçamento.</div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={`/fornecedor/oferta/${o.ofertaId}`}
          className="text-sm px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
        >
          Ver mockups e detalhes
        </Link>
        <button
          onClick={() => onResponder(o.ofertaId, 'aceitar')}
          disabled={agindo}
          className="text-sm px-4 py-2 rounded-lg text-white disabled:opacity-50"
          style={{ backgroundColor: VERDE }}
        >
          {agindo ? '...' : 'Assumir pedido'}
        </button>
        <button
          onClick={() => onResponder(o.ofertaId, 'recusar')}
          disabled={agindo}
          className="text-sm px-3 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          Recusar
        </button>
      </div>
    </div>
  )
}

function CardAceito({ o }: { o: Oferta }) {
  const cfg = ESTADO_CFG[o.estado]
  const destaque = o.estado === 'producao'
  return (
    <div
      className="rounded-2xl border bg-white p-5 shadow-sm"
      style={destaque ? { borderColor: VERDE } : { borderColor: '#e5e7eb' }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-xs text-gray-400">{data(o.criadoEm)}</div>
          <div className="font-semibold text-gray-900">
            {o.totalPecas} peças
            {o.clienteNome ? <span className="text-gray-400 font-normal"> · {o.clienteNome}</span> : null}
          </div>
        </div>
        <span className={'text-xs px-2.5 py-1 rounded-full whitespace-nowrap ' + cfg.pillClass}>{cfg.pill}</span>
      </div>

      <Resumo texto={o.resumo} />

      {/* Orientação */}
      <div
        className="mt-3 text-sm rounded-lg px-3 py-2"
        style={
          destaque
            ? { backgroundColor: VERDE_CLARO, color: VERDE_ESCURO }
            : o.estado === 'concluido'
              ? { backgroundColor: '#f3f4f6', color: '#4b5563' }
              : { backgroundColor: '#fffbeb', color: '#92400e' }
        }
      >
        {cfg.guidance}
      </div>

      {/* Valor */}
      <div className="mt-3">
        <ValorLabel o={o} />
      </div>

      {/* Ações contextuais */}
      <div className="mt-4 flex flex-wrap gap-2">
        {o.estado === 'orcar' && (
          <Link
            href={`/fornecedor/oferta/${o.ofertaId}/orcamento`}
            className="text-sm px-4 py-2 rounded-lg text-white"
            style={{ backgroundColor: VERDE }}
          >
            Definir orçamento →
          </Link>
        )}

        {o.estado === 'aguardando_cliente' && (
          <>
            <Link
              href={`/fornecedor/oferta/${o.ofertaId}`}
              className="text-sm px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              Ver detalhes
            </Link>
            <Link
              href={`/fornecedor/oferta/${o.ofertaId}/orcamento`}
              className="text-sm px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              Ajustar orçamento
            </Link>
          </>
        )}

        {o.estado === 'producao' && (
          <>
            <Link
              href={`/fornecedor/oferta/${o.ofertaId}`}
              className="text-sm px-4 py-2 rounded-lg text-white"
              style={{ backgroundColor: VERDE }}
            >
              Ver mockups e detalhes
            </Link>
            <Link
              href="/fornecedor/painel/envio"
              className="text-sm px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              Envio (Melhor Envio)
            </Link>
          </>
        )}

        {o.estado === 'concluido' && (
          <Link
            href={`/fornecedor/oferta/${o.ofertaId}`}
            className="text-sm px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            Ver mockups e detalhes
          </Link>
        )}
      </div>
    </div>
  )
}
