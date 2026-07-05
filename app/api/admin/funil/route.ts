// app/api/admin/funil/route.ts
// ============================================================================
// GET ?dias=7|30|90 → agregados do funil completo pro painel /admin/funil:
//
//   tráfego (eventos_site, tracker 1st-party) → ações no site → pedidos
//   (assistido + clássico) → status → fornecedor → desfecho.
//
// Devolve contadores por nó do mapa + listas de drill-down (com telefone pra
// abrir a conversa no inbox oficial via /admin/whatsapp?abrir=).
// Volumetria atual é pequena — agregação em JS; se o tráfego crescer muito,
// mover pra views SQL agregadas.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { tipoLabel } from '@/app/lib/ofertas-labels'

export const dynamic = 'force-dynamic'

type LinhaPA = { modelo?: string | null; total?: number | null }

function classificarFonte(utm: string | null, referrer: string | null): string {
  const s = (utm || '').toLowerCase().trim()
  if (s) {
    if (s.includes('insta') || s === 'ig') return 'instagram'
    if (s.includes('face') || s === 'fb' || s.includes('meta')) return 'facebook'
    if (s.includes('google') || s.includes('adwords')) return 'google'
    if (s.includes('tik')) return 'tiktok'
    if (s.includes('whats') || s === 'wa') return 'whatsapp'
    return s.slice(0, 24)
  }
  if (referrer) {
    try {
      const h = new URL(referrer).hostname.toLowerCase()
      if (h.includes('instagram')) return 'instagram'
      if (h.includes('facebook') || h.startsWith('fb.') || h.includes('.fb.')) return 'facebook'
      if (h.includes('google')) return 'google'
      if (h.includes('tiktok')) return 'tiktok'
      if (h.includes('whatsapp') || h.includes('wa.me')) return 'whatsapp'
      if (h.includes('bing')) return 'bing'
      return h.replace(/^www\./, '').slice(0, 24)
    } catch {
      return 'outros'
    }
  }
  return 'direto'
}

function resumoLinhas(linhas: unknown): { resumo: string; pecas: number } {
  const arr: LinhaPA[] = Array.isArray(linhas) ? (linhas as LinhaPA[]) : []
  const pecas = arr.reduce((acc, l) => acc + (typeof l.total === 'number' ? l.total : 0), 0)
  const primeiro = arr[0]?.modelo || null
  const resto = arr.length > 1 ? ` +${arr.length - 1}` : ''
  return { resumo: primeiro ? `${primeiro}${resto}` : `${arr.length} item(ns)`, pecas }
}

export async function GET(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  }

  const diasParam = parseInt(req.nextUrl.searchParams.get('dias') ?? '30', 10)
  const dias = Number.isFinite(diasParam) ? Math.min(Math.max(diasParam, 1), 365) : 30
  const desde = new Date(Date.now() - dias * 86400_000).toISOString()

  const [eventosQ, pasQ, opasQ, fornecedoresQ, pedidosQ, ofertasQ, contasQ, waConvQ, waContQ] =
    await Promise.all([
      supabaseAdmin
        .from('eventos_site')
        .select('sessao_id, tipo, utm_source, referrer, referencia_id, criado_em')
        .gte('criado_em', desde)
        .order('criado_em', { ascending: true })
        .limit(20000),
      supabaseAdmin
        .from('pedidos_assistente')
        .select('id, codigo, nome, telefone, email, status, valor_centavos, linhas, criado_em, confirmado_em')
        .gte('criado_em', desde)
        .order('criado_em', { ascending: false })
        .limit(500),
      supabaseAdmin
        .from('ofertas_pedido_assistente')
        .select('id, pedido_id, fornecedor_id, status, valor_repasse_centavos, criado_em, respondido_em')
        .gte('criado_em', desde)
        .order('criado_em', { ascending: false })
        .limit(500),
      supabaseAdmin.from('leads_fornecedores').select('id, nome').limit(2000),
      supabaseAdmin
        .from('pedidos')
        .select('id, nome, whatsapp, tipo, quantidade, estado, status, criado_em, fornecedor_aceito_id')
        .gte('criado_em', desde)
        .order('criado_em', { ascending: false })
        .limit(500),
      supabaseAdmin.from('ofertas').select('id, status').gte('enviada_em', desde).limit(5000),
      supabaseAdmin
        .from('contas_clientes')
        .select('id, nome, email, whatsapp, criado_em')
        .gte('criado_em', desde)
        .order('criado_em', { ascending: false })
        .limit(500),
      supabaseAdmin
        .from('wa_conversas')
        .select('id, contato_id, criado_em, preview')
        .gte('criado_em', desde)
        .limit(500),
      supabaseAdmin.from('wa_contatos').select('id, nome, wa_id').limit(2000),
    ])

  // ------------------------------------------------------------ tráfego
  const eventos = eventosQ.data ?? []
  const sessoes = new Map<string, string>() // sessao_id → fonte
  let pageviews = 0
  const sessoesAssistente = new Set<string>()
  let eventosPedidoEnviado = 0
  for (const e of eventos) {
    const fonte = classificarFonte(e.utm_source, e.referrer)
    if (e.tipo === 'pageview') {
      pageviews++
      if (!sessoes.has(e.sessao_id)) sessoes.set(e.sessao_id, fonte)
      // utm chegou depois da 1ª página? mantém a 1ª classificação não-direta
      else if (sessoes.get(e.sessao_id) === 'direto' && fonte !== 'direto') sessoes.set(e.sessao_id, fonte)
    } else if (e.tipo === 'assistente_iniciado') {
      sessoesAssistente.add(e.sessao_id)
      if (!sessoes.has(e.sessao_id)) sessoes.set(e.sessao_id, fonte)
    } else if (e.tipo === 'pedido_enviado') {
      eventosPedidoEnviado++
    }
  }
  const porFonte = new Map<string, number>()
  for (const fonte of sessoes.values()) porFonte.set(fonte, (porFonte.get(fonte) ?? 0) + 1)
  const origens = [...porFonte.entries()]
    .map(([fonte, n]) => ({ fonte, sessoes: n }))
    .sort((a, b) => b.sessoes - a.sessoes)

  // ------------------------------------------------- pedidos assistidos
  const nomeFornecedor = new Map<string, string>()
  for (const f of fornecedoresQ.data ?? []) nomeFornecedor.set(f.id, f.nome ?? 'Fornecedor')

  const pas = pasQ.data ?? []
  const paItem = (p: (typeof pas)[number]) => {
    const { resumo, pecas } = resumoLinhas(p.linhas)
    return {
      id: p.id,
      codigo: p.codigo ?? null,
      nome: p.nome ?? 'Sem nome',
      telefone: p.telefone ?? null,
      resumo,
      pecas,
      valorCentavos: p.valor_centavos ?? null,
      status: p.status,
      criadoEm: p.criado_em,
    }
  }
  const pelaMetade = pas.filter((p) => p.status === 'em_visualizacao' || p.status === 'completo').map(paItem)
  const confirmados = pas.filter((p) => p.status === 'confirmado').map(paItem)
  const cancelados = pas.filter((p) => p.status === 'cancelado').length
  const receitaCentavos = pas
    .filter((p) => p.status === 'confirmado')
    .reduce((acc, p) => acc + (p.valor_centavos ?? 0), 0)

  const nomePA = new Map<string, string>()
  for (const p of pas) nomePA.set(p.id, p.nome ?? 'Cliente')

  // --------------------------------------- encaminhamento a fornecedor
  const opas = opasQ.data ?? []
  const opaItem = (o: (typeof opas)[number]) => ({
    id: o.id,
    cliente: nomePA.get(o.pedido_id) ?? 'Cliente',
    fornecedor: nomeFornecedor.get(o.fornecedor_id) ?? 'Fornecedor',
    valorCentavos: o.valor_repasse_centavos ?? null,
    status: o.status,
    criadoEm: o.criado_em,
  })
  const encaminhados = opas.filter((o) => o.status === 'ofertada').map(opaItem)
  const aceitosForn = opas.filter((o) => o.status === 'aceita').map(opaItem)
  const opaPerdidas = opas.filter((o) => o.status === 'recusada' || o.status === 'cancelada').length

  // --------------------------------------------------- pedidos clássicos
  const pedidos = pedidosQ.data ?? []
  const pedidoItem = (p: (typeof pedidos)[number]) => ({
    id: p.id,
    nome: p.nome ?? 'Sem nome',
    telefone: p.whatsapp ?? null,
    resumo: [tipoLabel[p.tipo] ?? p.tipo, p.quantidade ? `${p.quantidade} pçs` : null, p.estado]
      .filter(Boolean)
      .join(' · '),
    fornecedor: p.fornecedor_aceito_id ? nomeFornecedor.get(p.fornecedor_aceito_id) ?? null : null,
    status: p.status,
    criadoEm: p.criado_em,
  })
  const buscando = pedidos.filter((p) => p.status === 'buscando_fornecedor').map(pedidoItem)
  const negociacao = pedidos.filter((p) => p.status === 'em_negociacao').map(pedidoItem)
  const expirados = pedidos.filter((p) => p.status === 'expirado_sem_resposta').length
  const concluidos = pedidos.filter((p) => p.status === 'concluido').map(pedidoItem)

  const ofertasCl = ofertasQ.data ?? []
  const contarOfertas = (s: string) => ofertasCl.filter((o) => o.status === s).length

  // ----------------------------------------------------------- contato
  const nomeContato = new Map<string, { nome: string | null; waId: string }>()
  for (const c of waContQ.data ?? []) nomeContato.set(c.id, { nome: c.nome, waId: c.wa_id })
  const waConversas = (waConvQ.data ?? []).map((c) => {
    const ct = nomeContato.get(c.contato_id)
    return { id: c.id, nome: ct?.nome ?? 'Contato', telefone: ct?.waId ?? null, criadoEm: c.criado_em }
  })
  const cadastros = (contasQ.data ?? []).map((c) => ({
    id: c.id,
    nome: c.nome ?? c.email,
    telefone: c.whatsapp ?? null,
    email: c.email,
    criadoEm: c.criado_em,
  }))

  return NextResponse.json({
    dias,
    site: { sessoes: sessoes.size, pageviews, origens },
    acoes: {
      assistenteIniciado: sessoesAssistente.size,
      pedidoEnviadoEventos: eventosPedidoEnviado,
      whatsapp: waConversas.length,
      cadastros: cadastros.length,
    },
    assistido: {
      criados: pas.length,
      pelaMetade,
      confirmados,
      cancelados,
      receitaCentavos,
    },
    classico: {
      criados: pedidos.length,
      buscando,
      negociacao,
      expirados,
      concluidos,
      ofertas: {
        enviadas: ofertasCl.length,
        aceitas: contarOfertas('aceita'),
        recusadas: contarOfertas('recusada'),
        expiradas: contarOfertas('expirada'),
      },
    },
    fornecedor: {
      encaminhados,
      aceitos: aceitosForn,
      perdidos: opaPerdidas,
    },
    contato: { waConversas, cadastros },
  })
}
