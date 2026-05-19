/**
 * GET    /api/admin/fornecedores/[id]   — detalhes + métricas + histórico
 * PATCH  /api/admin/fornecedores/[id]   — edita campos permitidos + audit
 *
 * Métricas calculadas:
 *   - ofertas_aceitas: count(ofertas where status='aceita')
 *   - taxa_resposta: (aceitas + recusadas) / (enviadas - expiradas)
 *   - ultima_oferta_em: max(enviada_em)
 *   - perdeu_para_outro: pedidos ofertados onde outro fornecedor foi aceito
 *
 * PATCH whitelist: nome, whatsapp, email, cidade, estado, tipos_produto,
 *                  raio_atendimento, pedido_minimo
 * Status NÃO é editável aqui — usar /pausar e /reativar.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { registrarAudit, diffMudancas } from '@/app/lib/audit'

const CAMPOS_EDITAVEIS = [
  'nome',
  'whatsapp',
  'email',
  'cidade',
  'estado',
  'tipos_produto',
  'raio_atendimento',
  'pedido_minimo',
] as const

const RAIOS_VALIDOS = new Set(['cidade', 'estado', 'regiao', 'nacional'])

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const cookieValue = req.cookies.get(COOKIE_ADMIN)?.value
  if (!ehTokenAdminValido(cookieValue)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  const { id } = await params

  const { data: fornecedor, error: errF } = await supabaseAdmin
    .from('leads_fornecedores')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (errF) return NextResponse.json({ erro: errF.message }, { status: 500 })
  if (!fornecedor) {
    return NextResponse.json({ erro: 'Fornecedor não encontrado' }, { status: 404 })
  }

  const { data: stats, error: errS } = await supabaseAdmin
    .from('ofertas')
    .select('status, enviada_em, pedido_id')
    .eq('fornecedor_id', id)

  if (errS) return NextResponse.json({ erro: errS.message }, { status: 500 })

  const ofertas = stats ?? []
  let aceitas = 0
  let recusadas = 0
  let expiradas = 0
  const enviadas = ofertas.length
  let ultimaOferta: string | null = null
  const pedidosOfertados: string[] = []

  for (const o of ofertas) {
    if (o.status === 'aceita') aceitas++
    else if (o.status === 'recusada') recusadas++
    else if (o.status === 'expirada') expiradas++
    if (o.pedido_id) pedidosOfertados.push(o.pedido_id)
    if (!ultimaOferta || (o.enviada_em && o.enviada_em > ultimaOferta)) {
      ultimaOferta = o.enviada_em
    }
  }

  const denom = enviadas - expiradas
  const taxaResposta = denom > 0 ? (aceitas + recusadas) / denom : null

  let perdeuParaOutro = 0
  if (pedidosOfertados.length > 0) {
    const { data: pedidos } = await supabaseAdmin
      .from('pedidos')
      .select('id, fornecedor_aceito_id')
      .in('id', pedidosOfertados)
      .not('fornecedor_aceito_id', 'is', null)
      .neq('fornecedor_aceito_id', id)
    perdeuParaOutro = pedidos?.length ?? 0
  }

  const { data: historico } = await supabaseAdmin
    .from('ofertas')
    .select(
      'id, status, enviada_em, respondida_em, tentativa_numero, ' +
        'pedido:pedidos(id, tipo, quantidade, estado, prazo, status)',
    )
    .eq('fornecedor_id', id)
    .order('enviada_em', { ascending: false })
    .limit(20)

  return NextResponse.json({
    fornecedor,
    metricas: {
      ofertas_aceitas: aceitas,
      ofertas_recusadas: recusadas,
      ofertas_enviadas: enviadas,
      ofertas_expiradas: expiradas,
      taxa_resposta: taxaResposta,
      ultima_oferta_em: ultimaOferta,
      perdeu_para_outro: perdeuParaOutro,
    },
    historico: historico ?? [],
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const cookieValue = req.cookies.get(COOKIE_ADMIN)?.value
  if (!ehTokenAdminValido(cookieValue)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ erro: 'Body JSON inválido' }, { status: 400 })
  }

  const atualizacao: Record<string, unknown> = {}
  for (const campo of CAMPOS_EDITAVEIS) {
    if (campo in body) atualizacao[campo] = body[campo]
  }

  if (Object.keys(atualizacao).length === 0) {
    return NextResponse.json(
      { erro: 'Nenhum campo editável no body' },
      { status: 400 },
    )
  }

  if ('raio_atendimento' in atualizacao) {
    const v = atualizacao.raio_atendimento
    if (typeof v !== 'string' || !RAIOS_VALIDOS.has(v)) {
      return NextResponse.json(
        { erro: `raio_atendimento inválido: ${v}` },
        { status: 400 },
      )
    }
  }
  if ('pedido_minimo' in atualizacao) {
    const v = atualizacao.pedido_minimo
    if (!Number.isInteger(v) || (v as number) < 0) {
      return NextResponse.json(
        { erro: 'pedido_minimo deve ser inteiro >= 0' },
        { status: 400 },
      )
    }
  }
  if ('tipos_produto' in atualizacao) {
    const v = atualizacao.tipos_produto
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
      return NextResponse.json(
        { erro: 'tipos_produto deve ser array de strings' },
        { status: 400 },
      )
    }
  }

  const { data: antes, error: errBefore } = await supabaseAdmin
    .from('leads_fornecedores')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (errBefore) return NextResponse.json({ erro: errBefore.message }, { status: 500 })
  if (!antes) return NextResponse.json({ erro: 'Fornecedor não encontrado' }, { status: 404 })

  atualizacao.atualizado_em = new Date().toISOString()
  const { data: depois, error: errUpd } = await supabaseAdmin
    .from('leads_fornecedores')
    .update(atualizacao)
    .eq('id', id)
    .select('*')
    .single()

  if (errUpd) return NextResponse.json({ erro: errUpd.message }, { status: 500 })

  await registrarAudit({
    ator: 'admin',
    acao: 'fornecedor.editar',
    entidade_tipo: 'leads_fornecedores',
    entidade_id: id,
    mudancas: diffMudancas(antes, depois),
    metadata: { user_agent: req.headers.get('user-agent') ?? null },
  })

  return NextResponse.json({ ok: true, fornecedor: depois })
}
