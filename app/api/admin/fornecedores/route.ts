/**
 * GET /api/admin/fornecedores
 *
 * Query string:
 *   ?status=ativo|pausado|todos     default: todos
 *   ?busca=texto                    busca em nome/cidade (ilike)
 *   ?vertical=fitness               filtro em tipos_produto (contains)
 *   ?ordem=nome|pedido_minimo|ultimo_lead_em|cidade|plano  default: ultimo_lead_em
 *   ?dir=asc|desc                   default: desc
 *   ?pagina=1                       default: 1
 *   ?por_pagina=50                  default: 50, max: 200
 *
 * Resposta: { dados, total, pagina, por_pagina }
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'

const ORDEM_PERMITIDA = new Set([
  'nome',
  'pedido_minimo',
  'ultimo_lead_em',
  'cidade',
  'plano',
])

export async function GET(req: NextRequest) {
  const cookieValue = req.cookies.get(COOKIE_ADMIN)?.value
  if (!ehTokenAdminValido(cookieValue)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  const url = req.nextUrl
  const status = url.searchParams.get('status') ?? 'todos'
  const busca = url.searchParams.get('busca')?.trim() ?? ''
  const vertical = url.searchParams.get('vertical')?.trim() ?? ''
  const ordem = url.searchParams.get('ordem') ?? 'ultimo_lead_em'
  const dir = url.searchParams.get('dir') === 'asc' ? 'asc' : 'desc'
  const pagina = Math.max(1, Number(url.searchParams.get('pagina')) || 1)
  const porPagina = Math.min(
    200,
    Math.max(1, Number(url.searchParams.get('por_pagina')) || 50),
  )

  if (!ORDEM_PERMITIDA.has(ordem)) {
    return NextResponse.json(
      { erro: `Campo de ordenação inválido: ${ordem}` },
      { status: 400 },
    )
  }

  let q = supabaseAdmin
    .from('leads_fornecedores')
    .select(
      'id, nome, whatsapp, email, cidade, estado, tipos_produto, ' +
        'raio_atendimento, pedido_minimo, plano, status, pausado_em, ' +
        'motivo_pausa, ultimo_lead_em, criado_em, atualizado_em',
      { count: 'exact' },
    )

  if (status === 'ativo' || status === 'pausado') {
    q = q.eq('status', status)
  }

  if (busca) {
    const esc = busca.replace(/[,%_]/g, ' ')
    q = q.or(`nome.ilike.%${esc}%,cidade.ilike.%${esc}%`)
  }

  if (vertical) {
    q = q.contains('tipos_produto', [vertical])
  }

  q = q.order(ordem, { ascending: dir === 'asc', nullsFirst: false })

  const inicio = (pagina - 1) * porPagina
  const fim = inicio + porPagina - 1
  q = q.range(inicio, fim)

  const { data, error, count } = await q

  if (error) {
    console.error('[GET /admin/fornecedores] erro:', error)
    return NextResponse.json({ erro: error.message }, { status: 500 })
  }

  return NextResponse.json({
    dados: data ?? [],
    total: count ?? 0,
    pagina,
    por_pagina: porPagina,
  })
}
