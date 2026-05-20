// app/fornecedor/painel/pedidos/PedidosTabs.tsx
'use client'

// ============================================================================
// Tabs Pendentes / Aceitas / Histórico — controla qual categoria mostrar.
// Recebe as 3 listas pré-carregadas do server component pai.
// ============================================================================

import { useState } from 'react'
import type { OfertaPainel } from '@/app/lib/ofertas-painel'
import CardOfertaPendente from './CardOfertaPendente'
import CardOfertaAceita from './CardOfertaAceita'
import CardOfertaHistorico from './CardOfertaHistorico'

type Tab = 'pendentes' | 'aceitas' | 'historico'

type Props = {
  pendentes: OfertaPainel[]
  aceitas: OfertaPainel[]
  historico: OfertaPainel[]
  linksArtes: Record<string, string>
}

export default function PedidosTabs({
  pendentes,
  aceitas,
  historico,
  linksArtes,
}: Props) {
  const [tab, setTab] = useState<Tab>('pendentes')

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'pendentes', label: 'Pendentes', count: pendentes.length },
    { id: 'aceitas', label: 'Aceitas', count: aceitas.length },
    { id: 'historico', label: 'Histórico', count: historico.length },
  ]

  return (
    <div>
      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6 overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {tabs.map((t) => {
            const isActive = tab === t.id
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`
                  px-4 py-3 text-sm font-medium border-b-2 transition-colors
                  ${
                    isActive
                      ? 'border-emerald-500 text-emerald-700'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }
                `}
              >
                {t.label}
                {t.count > 0 && (
                  <span
                    className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
                      isActive
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Conteúdo */}
      {tab === 'pendentes' && (
        <ListaOfertas
          ofertas={pendentes}
          tipo="pendentes"
          mensagemVazio="Nenhum pedido pendente no momento. Quando chegar um pedido novo, ele aparecerá aqui."
        />
      )}

      {tab === 'aceitas' && (
        <ListaOfertas
          ofertas={aceitas}
          tipo="aceitas"
          linksArtes={linksArtes}
          mensagemVazio="Você ainda não aceitou nenhum pedido. As aceitas vão aparecer aqui com o contato direto do cliente."
        />
      )}

      {tab === 'historico' && (
        <ListaOfertas
          ofertas={historico}
          tipo="historico"
          mensagemVazio="Sem histórico nos últimos 90 dias."
        />
      )}
    </div>
  )
}

// ============================================================
// Lista (subcomponente)
// ============================================================
function ListaOfertas({
  ofertas,
  tipo,
  mensagemVazio,
  linksArtes,
}: {
  ofertas: OfertaPainel[]
  tipo: Tab
  mensagemVazio: string
  linksArtes?: Record<string, string>
}) {
  if (ofertas.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center">
        <div className="text-4xl mb-3">📭</div>
        <p className="text-gray-500 text-sm">{mensagemVazio}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {ofertas.map((oferta) => {
        if (tipo === 'pendentes') {
          return <CardOfertaPendente key={oferta.id} oferta={oferta} />
        }
        if (tipo === 'aceitas') {
          return (
            <CardOfertaAceita
              key={oferta.id}
              oferta={oferta}
              artesUrl={linksArtes?.[oferta.pedido_id]}
            />
          )
        }
        return <CardOfertaHistorico key={oferta.id} oferta={oferta} />
      })}
    </div>
  )
}
