// app/fornecedor/painel/pedidos/CardOfertaHistorico.tsx

// ============================================================================
// Card de oferta no HISTÓRICO — discreto, sem ações, sem contato.
// Mostra que houve uma oferta recusada ou expirada com data e motivo.
// ============================================================================

import type { OfertaPainel } from '@/app/lib/ofertas-painel'
import { tipoLabel, prazoLabel } from '@/app/lib/ofertas-labels'

type Props = {
  oferta: OfertaPainel
}

export default function CardOfertaHistorico({ oferta }: Props) {
  const tipo = tipoLabel[oferta.pedido_tipo] ?? oferta.pedido_tipo
  const prazo = prazoLabel[oferta.pedido_prazo] ?? oferta.pedido_prazo
  const dataAcao = formatarData(oferta.criado_em)
  const { rotulo, classes } = statusVisual(oferta.status)

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 opacity-90">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-gray-900 font-medium text-sm truncate">{tipo}</h3>
          <div className="text-gray-500 text-xs mt-0.5">
            {oferta.pedido_quantidade
              ? `${oferta.pedido_quantidade} peças · `
              : ''}
            {oferta.pedido_estado} · {prazo}
          </div>
          <div className="text-gray-400 text-xs mt-1">{dataAcao}</div>
        </div>

        <div
          className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap ${classes}`}
        >
          {rotulo}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Helper: status → rótulo + cor
// ============================================================
function statusVisual(status: string): { rotulo: string; classes: string } {
  if (status === 'recusada') {
    return {
      rotulo: 'Recusada',
      classes: 'bg-gray-100 text-gray-600',
    }
  }
  if (status === 'expirada') {
    return {
      rotulo: 'Expirada',
      classes: 'bg-amber-50 text-amber-700',
    }
  }
  if (status === 'recusada_sem_credito') {
    return {
      rotulo: 'Sem crédito',
      classes: 'bg-orange-50 text-orange-700',
    }
  }
  return {
    rotulo: status,
    classes: 'bg-gray-100 text-gray-600',
  }
}

// ============================================================
// Helper: formata data ISO para "DD/MM/AAAA"
// ============================================================
function formatarData(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return ''
  }
}
