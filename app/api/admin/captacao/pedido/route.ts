// app/api/admin/captacao/pedido/route.ts
// ============================================================================
// Painel da captação puxada pelo pedido.
//
// GET  → { modo, config, hoje: {contatados, teto}, pedidos: [pedidos sem
//          fornecedor com buscas e candidatos], buscas: últimas rodadas }
// PUT  { modo?, max_por_pedido?, max_por_dia?, regioes?, horas_entre_buscas? }
// POST { acao: 'buscar', pedidoId, regiao? }          → roda a busca agora pra um pedido
//      { acao: 'abordar', candidatoId }                → manda a sondagem de um candidato 'sugerido'
//      { acao: 'rodar' }                               → roda a rodada inteira (o que o cron faria)
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { pedidoEtapa, pedidosPorEtapa } from '@/app/lib/etapas-pedido'
import {
  buscasRecentes,
  candidatosPorPedido,
  captarParaPedido,
  configCaptacao,
  contatadosHoje,
  definirConfigCaptacao,
  enviarSondagem,
  pdfSondagem,
  perfilDeBusca,
  REGIOES,
  rodarCaptacaoPedidos,
  type RegiaoBusca,
} from '@/app/lib/captacao-pedido'
import { ehModoLuigi } from '@/app/lib/luigi-catalogo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

function naoAutorizado() {
  return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
}

export async function GET(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) return naoAutorizado()
  try {
    const [{ modo, config }, hoje, pedidos, buscas] = await Promise.all([configCaptacao(), contatadosHoje(), pedidosPorEtapa(['sem_fornecedor', 'buscando_fornecedor'], 60), buscasRecentes(40)])
    const candidatos = await candidatosPorPedido(pedidos.map((p) => p.id))
    const buscasPorPedido = new Map<string, number>()
    for (const b of buscas) buscasPorPedido.set(b.pedido_id, (buscasPorPedido.get(b.pedido_id) ?? 0) + 1)
    return NextResponse.json({
      modo,
      config,
      regioes: REGIOES,
      hoje: { contatados: hoje, teto: config.max_por_dia },
      pedidos: pedidos.map((p) => ({
        id: p.id,
        codigo: p.codigo,
        nome: p.nome,
        cidade: p.cidade,
        uf: p.uf,
        etapa: p.etapa,
        desde: p.desde,
        descricao: perfilDeBusca(p, null).descricao,
        confirmado_em: p.confirmado_em,
        elegivel: new Date(p.confirmado_em ?? p.desde).getTime() >= Date.now() - config.idade_max_dias * 86400_000,
        buscas: buscasPorPedido.get(p.id) ?? 0,
        candidatos: candidatos[p.id] ?? [],
      })),
      buscas,
    })
  } catch (err) {
    console.error('[captacao-pedido admin] GET falhou', { err })
    return NextResponse.json({ erro: 'Falha ao carregar a captação por pedido' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) return naoAutorizado()
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ erro: 'Dados inválidos' }, { status: 400 })
  if (body.modo !== undefined && !ehModoLuigi(body.modo)) return NextResponse.json({ erro: 'modo inválido' }, { status: 400 })
  const regioes = Array.isArray(body.regioes) ? (body.regioes as unknown[]).filter((r): r is RegiaoBusca => REGIOES.includes(r as RegiaoBusca)) : undefined
  try {
    await definirConfigCaptacao({
      ...(ehModoLuigi(body.modo) ? { modo: body.modo } : {}),
      ...(typeof body.max_por_pedido === 'number' ? { max_por_pedido: body.max_por_pedido } : {}),
      ...(typeof body.max_por_dia === 'number' ? { max_por_dia: body.max_por_dia } : {}),
      ...(typeof body.horas_entre_buscas === 'number' ? { horas_entre_buscas: body.horas_entre_buscas } : {}),
      ...(typeof body.idade_max_dias === 'number' ? { idade_max_dias: body.idade_max_dias } : {}),
      ...(regioes && regioes.length ? { regioes } : {}),
    })
    return NextResponse.json({ ok: true, ...(await configCaptacao()) })
  } catch (err) {
    console.error('[captacao-pedido admin] PUT falhou', { err })
    return NextResponse.json({ erro: 'Falha ao salvar' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) return naoAutorizado()
  const body = (await req.json().catch(() => null)) as { acao?: string; pedidoId?: string; regiao?: string; candidatoId?: string } | null
  if (!body?.acao) return NextResponse.json({ erro: 'acao é obrigatória' }, { status: 400 })
  try {
    if (body.acao === 'rodar') {
      return NextResponse.json({ ok: true, resultado: await rodarCaptacaoPedidos('admin') })
    }
    if (body.acao === 'buscar') {
      if (!body.pedidoId) return NextResponse.json({ erro: 'pedidoId é obrigatório' }, { status: 400 })
      const pedido = await pedidoEtapa(body.pedidoId)
      if (!pedido) return NextResponse.json({ erro: 'Pedido não encontrado' }, { status: 404 })
      const regiao = REGIOES.includes(body.regiao as RegiaoBusca) ? (body.regiao as RegiaoBusca) : undefined
      const r = await captarParaPedido(pedido, { origem: 'admin', regiao, forcar: true })
      return NextResponse.json({ ok: !r.erro, resultado: r })
    }
    if (body.acao === 'abordar') {
      if (!body.candidatoId) return NextResponse.json({ erro: 'candidatoId é obrigatório' }, { status: 400 })
      const { data: c } = await supabaseAdmin
        .from('captacao_fornecedores')
        .select('id, nome, email, whatsapp, pedido_id, status')
        .eq('id', body.candidatoId)
        .maybeSingle<{ id: string; nome: string | null; email: string | null; whatsapp: string | null; pedido_id: string | null; status: string }>()
      if (!c || !c.pedido_id) return NextResponse.json({ erro: 'Candidato não encontrado' }, { status: 404 })
      const pedido = await pedidoEtapa(c.pedido_id)
      if (!pedido) return NextResponse.json({ erro: 'Pedido não encontrado' }, { status: 404 })
      const { data: prazo } = await supabaseAdmin.from('pedidos_assistente').select('prazo_dias').eq('id', pedido.id).maybeSingle<{ prazo_dias: number | null }>()
      const perfil = perfilDeBusca(pedido, prazo?.prazo_dias ?? null)
      const pdf = await pdfSondagem(pedido.id).catch(() => null)
      const r = await enviarSondagem(c.id, { nome: c.nome, email: c.email, whatsapp: c.whatsapp && c.whatsapp.length >= 12 ? c.whatsapp : null }, perfil, pdf)
      return NextResponse.json({ ok: Boolean(r.email || r.whatsapp), resultado: r })
    }
    return NextResponse.json({ erro: 'acao desconhecida' }, { status: 400 })
  } catch (err) {
    const erro = err instanceof Error ? err.message : String(err)
    console.error('[captacao-pedido admin] POST falhou', { erro })
    return NextResponse.json({ erro }, { status: 500 })
  }
}
