// app/fornecedor/painel/pedidos/CardOfertaAceita.tsx

// ============================================================================
// Card de oferta ACEITA — mostra dados completos do cliente para contato
// direto. Server component (sem state, sem fetch). Renderizado pela tab
// Aceitas a partir de ofertas já carregadas pelo server component pai.
// ============================================================================

import type { OfertaPainel } from '@/app/lib/ofertas-painel'
import { tipoLabel, prazoLabel } from '@/app/lib/ofertas-labels'

type Props = {
  oferta: OfertaPainel
  // URL pública das artes compartilhadas, quando há compartilhamento válido
  // (não-expirado) deste pedido pra este fornecedor. Ausente = não renderiza.
  artesUrl?: string
}

export default function CardOfertaAceita({ oferta, artesUrl }: Props) {
  const tipo = tipoLabel[oferta.pedido_tipo] ?? oferta.pedido_tipo
  const prazo = prazoLabel[oferta.pedido_prazo] ?? oferta.pedido_prazo
  const dataAceite = formatarData(oferta.criado_em)

  // Defesa: se por algum motivo não temos contato, mostra fallback
  const temContato = oferta.cliente_nome && oferta.cliente_whatsapp

  return (
    <div className="bg-white border border-emerald-200 rounded-2xl p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-gray-900 font-medium text-base">{tipo}</h3>
          <div className="text-gray-600 text-sm mt-0.5">
            {oferta.pedido_quantidade
              ? `${oferta.pedido_quantidade} peças · `
              : ''}
            {oferta.pedido_estado} · {prazo}
          </div>
        </div>
        <div className="px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap bg-emerald-50 text-emerald-700">
          ✓ Aceito
        </div>
      </div>

      {oferta.pedido_descricao && oferta.pedido_descricao.trim() && (
        <p className="text-gray-700 text-sm mb-4">
          <span className="text-gray-500">Detalhes: </span>
          {oferta.pedido_descricao}
        </p>
      )}

      {/* Contato do cliente */}
      {temContato ? (
        <div className="bg-emerald-50 rounded-xl p-4 space-y-3">
          <div className="text-emerald-900 text-xs font-medium uppercase tracking-wide mb-1">
            Contato do cliente
          </div>

          <Linha rotulo="Nome" valor={oferta.cliente_nome ?? ''} />

          <Linha
            rotulo="WhatsApp"
            valor={oferta.cliente_whatsapp ?? ''}
            link={`https://wa.me/${(oferta.cliente_whatsapp ?? '').replace(/\D/g, '')}`}
            linkLabel="Abrir conversa"
          />

          {oferta.cliente_email && (
            <Linha rotulo="E-mail" valor={oferta.cliente_email} />
          )}
        </div>
      ) : (
        <div className="bg-gray-50 rounded-xl p-4 text-center text-gray-500 text-sm">
          Contato indisponível
        </div>
      )}

      {artesUrl && (
        <a
          href={artesUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-emerald-700 text-sm font-medium hover:text-emerald-800 underline"
        >
          Ver artes compartilhadas →
        </a>
      )}

      <p className="text-gray-400 text-xs mt-3">Aceito em {dataAceite}</p>
    </div>
  )
}

// ============================================================
// Subcomponente: linha de dado do cliente
// ============================================================
function Linha({
  rotulo,
  valor,
  link,
  linkLabel,
}: {
  rotulo: string
  valor: string
  link?: string
  linkLabel?: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div>
        <div className="text-gray-500 text-xs">{rotulo}</div>
        <div className="text-gray-900 text-sm font-medium">{valor}</div>
      </div>
      {link && linkLabel && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="text-emerald-700 text-xs font-medium hover:text-emerald-800 underline"
        >
          {linkLabel} →
        </a>
      )}
    </div>
  )
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
