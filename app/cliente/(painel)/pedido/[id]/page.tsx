// app/cliente/(painel)/pedido/[id]/page.tsx
// ============================================================================
// Detalhes de 1 pedido do cliente logado.
// Validação dupla: WHERE id=$1 AND conta_id=$contaAtual.
// Se não existir/não pertencer → redirect pro painel.
// ============================================================================

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getContaAtual } from '@/app/lib/cliente-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { tipoLabel, prazoLabel } from '@/app/lib/ofertas-labels'
import { formatarWhatsappBR } from '@/app/lib/format'
import { linkWhatsApp } from '@/app/lib/phone'

export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<string, { label: string; cor: string }> = {
  novo: { label: 'Novo', cor: 'bg-gray-100 text-gray-700' },
  buscando_fornecedor: {
    label: 'Buscando fornecedor',
    cor: 'bg-blue-100 text-blue-800',
  },
  aguardando_contato: {
    label: 'Fornecedor encontrado',
    cor: 'bg-green-100 text-green-800',
  },
  finalizado: { label: 'Finalizado', cor: 'bg-emerald-100 text-emerald-800' },
  orfao: { label: 'Sem fornecedor', cor: 'bg-orange-100 text-orange-800' },
}

type PedidoDetalhe = {
  id: string
  tipo: string
  quantidade: number | null
  estado: string | null
  prazo: string | null
  status: string
  criado_em: string
  descricao: string | null
  fornecedor_aceito_id: string | null
  fornecedor_aceito?: {
    nome: string | null
    whatsapp: string
  } | null
}

type OfertaTimeline = {
  id: string
  status: string
  enviada_em: string
  respondida_em: string | null
}

export default async function PedidoDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const conta = await getContaAtual()
  if (!conta) return null

  const { id } = await params

  const { data: pedidoRaw } = await supabaseAdmin
    .from('pedidos')
    .select(
      'id, tipo, quantidade, estado, prazo, status, criado_em, descricao, ' +
        'fornecedor_aceito_id, ' +
        'fornecedor_aceito:leads_fornecedores!fornecedor_aceito_id(nome, whatsapp)',
    )
    .eq('id', id)
    .eq('conta_id', conta.id)
    .maybeSingle()

  if (!pedidoRaw) {
    notFound()
  }

  const pedido = pedidoRaw as unknown as PedidoDetalhe

  // Timeline de ofertas (mínimo: data + status)
  const { data: ofertasRaw } = await supabaseAdmin
    .from('ofertas')
    .select('id, status, enviada_em, respondida_em')
    .eq('pedido_id', id)
    .order('enviada_em', { ascending: true })

  const ofertas = (ofertasRaw ?? []) as OfertaTimeline[]

  const tipo = tipoLabel[pedido.tipo] ?? pedido.tipo
  const prazo = pedido.prazo ? (prazoLabel[pedido.prazo] ?? pedido.prazo) : null
  const statusInfo =
    STATUS_LABEL[pedido.status] ?? {
      label: pedido.status,
      cor: 'bg-gray-100 text-gray-500',
    }
  const criado = new Date(pedido.criado_em).toLocaleDateString('pt-BR')

  const aceito = pedido.fornecedor_aceito_id && pedido.fornecedor_aceito

  return (
    <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <Link
        href="/cliente/painel"
        className="text-sm text-gray-600 hover:text-gray-900 inline-block mb-4"
      >
        ← Voltar
      </Link>

      <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-6">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{tipo}</h1>
            <p className="text-xs text-gray-500 mt-0.5">Criado em {criado}</p>
          </div>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${statusInfo.cor}`}
          >
            {statusInfo.label}
          </span>
        </div>

        <dl className="text-sm text-gray-700 space-y-1.5">
          {pedido.quantidade !== null && (
            <div className="flex gap-2">
              <dt className="text-gray-500 min-w-[110px]">Quantidade:</dt>
              <dd>{pedido.quantidade} peças</dd>
            </div>
          )}
          {pedido.estado && (
            <div className="flex gap-2">
              <dt className="text-gray-500 min-w-[110px]">Estado:</dt>
              <dd>{pedido.estado}</dd>
            </div>
          )}
          {prazo && (
            <div className="flex gap-2">
              <dt className="text-gray-500 min-w-[110px]">Prazo:</dt>
              <dd>{prazo}</dd>
            </div>
          )}
          {pedido.descricao && (
            <div className="flex gap-2">
              <dt className="text-gray-500 min-w-[110px]">Descrição:</dt>
              <dd className="whitespace-pre-wrap">{pedido.descricao}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* Status / Fornecedor */}
      {aceito && pedido.fornecedor_aceito && (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-5 mb-6">
          <div className="text-xs uppercase tracking-wider text-green-800 font-semibold mb-2">
            Fornecedor encontrado
          </div>
          <div className="text-lg font-semibold text-gray-900">
            {pedido.fornecedor_aceito.nome ?? 'Fornecedor confirmado'}
          </div>
          <div className="text-sm text-gray-700 mt-0.5">
            📱 {formatarWhatsappBR(pedido.fornecedor_aceito.whatsapp)}
          </div>
          <a
            href={linkWhatsApp(pedido.fornecedor_aceito.whatsapp)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block px-5 py-2.5 rounded-md bg-[#1D9E75] text-white text-sm font-medium hover:bg-[#178761]"
          >
            Conversar no WhatsApp
          </a>
        </div>
      )}

      {pedido.status === 'orfao' && (
        <div className="bg-orange-50 border border-orange-200 rounded-2xl p-5 mb-6">
          <div className="text-orange-900 font-medium text-sm mb-1">
            Estamos com dificuldade em encontrar fornecedor
          </div>
          <p className="text-orange-800 text-sm">
            Nossa equipe foi notificada e está procurando ativamente um
            fornecedor compatível pro seu pedido. Te avisaremos assim que
            tivermos novidade.
          </p>
        </div>
      )}

      {/* Timeline */}
      {ofertas.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">
            Histórico
          </h3>
          <ul className="space-y-2 text-sm">
            <li className="flex gap-3">
              <span className="text-gray-400 min-w-[80px]">{criado}</span>
              <span>Pedido criado</span>
            </li>
            {ofertas.map((o) => {
              const d = new Date(o.enviada_em).toLocaleDateString('pt-BR')
              return (
                <li key={o.id} className="flex gap-3">
                  <span className="text-gray-400 min-w-[80px]">{d}</span>
                  <span>
                    {statusOfertaTxt(o.status)}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}

function statusOfertaTxt(status: string): string {
  switch (status) {
    case 'enviada':
      return 'Oferta enviada pra um fornecedor compatível'
    case 'aceita':
      return 'Fornecedor aceitou seu pedido'
    case 'recusada':
      return 'Fornecedor recusou — buscando outro'
    case 'expirada':
      return 'Fornecedor não respondeu a tempo — buscando outro'
    default:
      return `Oferta ${status}`
  }
}
