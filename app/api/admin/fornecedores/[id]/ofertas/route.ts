/**
 * GET /api/admin/fornecedores/[id]/ofertas
 *
 * Lista paginada de ofertas enviadas pra esse fornecedor + dados do pedido.
 *
 * Query string:
 *   ?status=todas|aceita|recusada|expirada|pendente  default: todas
 *   ?pagina=1                                         default: 1
 *   ?por_pagina=20                                    default: 20, max: 100
 *
 * Convenção "pendente": status NOT IN ('aceita','recusada','expirada').
 * Cobre 'enviada' e valores futuros que não sejam finais.
 *
 * Resposta por oferta:
 *   { id, status, enviada_em, respondida_em, tentativa_numero,
 *     tempo_resposta_ms (null se pendente), pedido: {...} }
 *
 * Ordenação: enviada_em DESC.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'

const STATUS_FINAIS = ['aceita', 'recusada', 'expirada'] as const

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const cookieValue = req.cookies.get(COOKIE_ADMIN)?.value
  if (!ehTokenAdminValido(cookieValue)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  const { id } = await params
  const url = req.nextUrl
  const status = url.searchParams.get('status') ?? 'todas'
  const pagina = Math.max(1, Number(url.searchParams.get('pagina')) || 1)
  const porPagina = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get('por_pagina')) || 20),
  )

  let q = supabaseAdmin
    .from('ofertas')
    .select(
      'id, status, enviada_em, respondida_em, tentativa_numero, ' +
        'pedido:pedidos(id, tipo, quantidade, estado, prazo, status, ' +
        'criado_em, fornecedor_aceito_id)',
      { count: 'exact' },
    )
    .eq('fornecedor_id', id)

  if (status === 'aceita' || status === 'recusada' || status === 'expirada') {
    q = q.eq('status', status)
  } else if (status === 'pendente') {
    q = q.not('status', 'in', `(${STATUS_FINAIS.map((s) => `"${s}"`).join(',')})`)
  }
  // status === 'todas' → sem filtro

  q = q.order('enviada_em', { ascending: false })

  const inicio = (pagina - 1) * porPagina
  const fim = inicio + porPagina - 1
  q = q.range(inicio, fim)

  const { data, error, count } = await q

  if (error) {
    console.error('[GET /admin/fornecedores/[id]/ofertas] erro:', error)
    return NextResponse.json({ erro: error.message }, { status: 500 })
  }

  // Enriquece com tempo_resposta_ms calculado
  type LinhaOferta = {
    id: string
    status: string
    enviada_em: string | null
    respondida_em: string | null
    tentativa_numero: number | null
    pedido: unknown
  }
  const dados = (data ?? []).map((o) => {
    const linha = o as unknown as LinhaOferta
    let tempo_resposta_ms: number | null = null
    if (linha.enviada_em && linha.respondida_em) {
      const delta =
        new Date(linha.respondida_em).getTime() -
        new Date(linha.enviada_em).getTime()
      tempo_resposta_ms = delta >= 0 ? delta : null
    }
    return {
      id: linha.id,
      status: linha.status,
      enviada_em: linha.enviada_em,
      respondida_em: linha.respondida_em,
      tentativa_numero: linha.tentativa_numero,
      tempo_resposta_ms,
      pedido: linha.pedido,
    }
  })

  return NextResponse.json({
    dados,
    total: count ?? 0,
    pagina,
    por_pagina: porPagina,
  })
}
