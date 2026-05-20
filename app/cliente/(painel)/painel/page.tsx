// app/cliente/(painel)/painel/page.tsx
// ============================================================================
// Página principal do cliente logado. Lista pedidos vinculados à conta dele
// (via pedidos.conta_id — backfill lazy popula no primeiro login).
// ============================================================================

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getContaAtual, perfilCompleto } from '@/app/lib/cliente-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { tipoLabel, prazoLabel } from '@/app/lib/ofertas-labels'
import { corStatus, labelStatus } from '@/app/lib/cliente-status'

export const dynamic = 'force-dynamic'

type PedidoLinha = {
  id: string
  tipo: string
  quantidade: number | null
  estado: string | null
  prazo: string | null
  status: string
  criado_em: string
  fornecedor_aceito_id: string | null
}

export default async function PainelClientePage({
  searchParams,
}: {
  searchParams: Promise<{ criado?: string }>
}) {
  // Layout já redirecionou se não logado — getContaAtual sempre vai retornar conta
  const conta = await getContaAtual()
  if (!conta) {
    // defensivo (não deveria acontecer)
    return null
  }
  // Force complete perfil: sem WhatsApp não dá pra usar o painel
  if (!perfilCompleto(conta)) {
    redirect('/cliente/perfil?completar=1')
  }
  const { criado } = await searchParams

  const { data: pedidosRaw } = await supabaseAdmin
    .from('pedidos')
    .select(
      'id, tipo, quantidade, estado, prazo, status, criado_em, fornecedor_aceito_id',
    )
    .eq('conta_id', conta.id)
    .order('criado_em', { ascending: false })

  const pedidos = (pedidosRaw ?? []) as PedidoLinha[]

  return (
    <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {criado && (
        <div className="mb-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          Pedido recebido! Vamos buscar fornecedores compatíveis e te avisar por aqui.
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-900">Seus pedidos</h2>
        {pedidos.length > 0 && (
          <Link
            href="/cliente/pedido/novo"
            className="inline-flex items-center gap-1 px-4 py-2 rounded-md bg-[#1D9E75] text-white text-sm font-medium hover:bg-[#178761]"
          >
            + Novo pedido
          </Link>
        )}
      </div>

      {pedidos.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center">
          <p className="text-sm text-gray-600 mb-4">
            Você ainda não tem pedidos.
          </p>
          <Link
            href="/cliente/pedido/novo"
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
  const prazo = pedido.prazo ? (prazoLabel[pedido.prazo] ?? pedido.prazo) : null
  const dataHora = formatarDataHora(pedido.criado_em)

  return (
    <li>
      <Link
        href={`/cliente/pedido/${pedido.id}`}
        className="block bg-white border border-gray-200 rounded-2xl p-4 hover:border-gray-300 transition-colors group"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
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
              {prazo && (
                <span className="text-gray-500 text-sm">· Prazo: {prazo}</span>
              )}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Criado em {dataHora}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${corStatus(pedido.status)}`}
            >
              {labelStatus(pedido.status)}
            </span>
            <span
              aria-hidden="true"
              className="text-gray-400 group-hover:text-gray-600 transition-colors text-lg leading-none"
            >
              ›
            </span>
          </div>
        </div>
      </Link>
    </li>
  )
}

function formatarDataHora(iso: string): string {
  const d = new Date(iso)
  const dia = String(d.getDate()).padStart(2, '0')
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const ano = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${dia}/${mes}/${ano} às ${hh}:${mm}`
}
