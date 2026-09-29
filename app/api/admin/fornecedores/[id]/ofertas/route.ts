/**
 * GET /api/admin/fornecedores/[id]/ofertas
 *
 * Lista paginada de ofertas enviadas pra esse fornecedor + dados do pedido,
 * das duas eras (`ofertas` legado + `ofertas_pedido_assistente`).
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
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { ofertasDoFornecedor } from '@/app/lib/admin-fornecedor-ofertas'

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

  // As duas eras (ver admin-fornecedor-ofertas.ts). O volume por confecção
  // é pequeno (dezenas), então a paginação é em memória depois do merge.
  let todas
  try {
    todas = await ofertasDoFornecedor(id)
  } catch (e) {
    console.error('[GET /admin/fornecedores/[id]/ofertas] erro:', e)
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'falha ao ler ofertas' }, { status: 500 })
  }
  const filtradas =
    status === 'aceita' || status === 'recusada' || status === 'expirada'
      ? todas.filter((o) => o.status === status)
      : status === 'pendente'
        ? todas.filter((o) => !(STATUS_FINAIS as readonly string[]).includes(o.status))
        : todas

  const inicio = (pagina - 1) * porPagina
  const dados = filtradas.slice(inicio, inicio + porPagina)

  return NextResponse.json({
    dados,
    total: filtradas.length,
    pagina,
    por_pagina: porPagina,
  })
}
