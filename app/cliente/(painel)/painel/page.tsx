// app/cliente/(painel)/painel/page.tsx
// ============================================================================
// Página principal do cliente logado. Lista pedidos vinculados à conta dele
// (via pedidos.conta_id — backfill lazy popula no primeiro login).
// ============================================================================

import Link from 'next/link'
import { getContaAtual } from '@/app/lib/cliente-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { tipoLabel } from '@/app/lib/ofertas-labels'

export const dynamic = 'force-dynamic'

type PedidoLinha = {
  id: string
  tipo: string
  quantidade: number | null
  estado: string | null
  status: string
  criado_em: string
  fornecedor_aceito_id: string | null
}

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

export default async function PainelClientePage() {
  // Layout já redirecionou se não logado — getContaAtual sempre vai retornar conta
  const conta = await getContaAtual()
  if (!conta) {
    // defensivo (não deveria acontecer)
    return null
  }

  const { data: pedidosRaw } = await supabaseAdmin
    .from('pedidos')
    .select('id, tipo, quantidade, estado, status, criado_em, fornecedor_aceito_id')
    .eq('conta_id', conta.id)
    .order('criado_em', { ascending: false })

  const pedidos = (pedidosRaw ?? []) as PedidoLinha[]

  return (
    <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Card do plano */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-6">
        <div className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
          Seu plano
        </div>
        <div className="text-lg font-semibold text-gray-900 mt-0.5 capitalize">
          {conta.plano}
        </div>
      </div>

      <h2 className="text-lg font-semibold text-gray-900 mb-3">Seus pedidos</h2>

      {pedidos.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center">
          <p className="text-sm text-gray-600 mb-4">
            Você ainda não tem pedidos.
          </p>
          <Link
            href="/"
            className="inline-block px-5 py-2.5 rounded-md bg-[#1D9E75] text-white text-sm font-medium hover:bg-[#178761]"
          >
            Fazer pedido
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {pedidos.map((p) => (
            <LinhaPedido key={p.id} pedido={p} />
          ))}
        </ul>
      )}
    </section>
  )
}

function LinhaPedido({ pedido }: { pedido: PedidoLinha }) {
  const tipo = tipoLabel[pedido.tipo] ?? pedido.tipo
  const statusInfo =
    STATUS_LABEL[pedido.status] ?? {
      label: pedido.status,
      cor: 'bg-gray-100 text-gray-500',
    }
  const data = new Date(pedido.criado_em).toLocaleDateString('pt-BR')

  return (
    <li>
      <Link
        href={`/cliente/pedido/${pedido.id}`}
        className="block bg-white border border-gray-200 rounded-2xl p-4 hover:border-gray-300 transition-colors"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-gray-900 font-medium">{tipo}</span>
              {pedido.quantidade !== null && (
                <span className="text-gray-500 text-sm">
                  · {pedido.quantidade} peças
                </span>
              )}
              {pedido.estado && (
                <span className="text-gray-500 text-sm">· {pedido.estado}</span>
              )}
            </div>
            <div className="text-xs text-gray-500 mt-1">Criado em {data}</div>
          </div>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${statusInfo.cor}`}
          >
            {statusInfo.label}
          </span>
        </div>
      </Link>
    </li>
  )
}
