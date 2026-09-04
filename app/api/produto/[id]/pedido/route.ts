// POST /api/produto/[id]/pedido
// ============================================================================
// Pedido direto, a partir de um produto da vitrine, para UMA confecção.
//
// Decisão do Fernando (04/09/2026): esse pedido não vai a leilão. Nasce como
// pedido do fluxo assistido e a oferta é criada só para o dono do produto. Se
// ele recusar, o admin reoferta a quem quiser — a fila normal continua ali.
//
// A rota é PÚBLICA (a vitrine é pública), então ela: valida tudo do lado do
// servidor, ignora qualquer preço vindo do cliente e trava repetição por
// telefone. O corpo do formulário nunca escolhe o fornecedor: quem escolhe é o
// produto, lido do banco.
// ============================================================================

import { supabaseAdmin } from '@/app/lib/supabase-server'
import { getProdutoPublico } from '@/app/lib/portfolio-fornecedor'
import { ofertarPedido } from '@/app/lib/pedido-assistente-oferta'

export const maxDuration = 60 // criar pedido + notificar fornecedor (WhatsApp/e-mail)

const MAX_POR_TELEFONE = 3
const JANELA_MIN = 30

function texto(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim().slice(0, max)
  return t || null
}

/** Só dígitos, com DDI 55 na frente — mesmo formato que o resto do sistema usa. */
function normalizarTelefone(v: unknown): string | null {
  const d = (typeof v === 'string' ? v : '').replace(/\D/g, '')
  if (d.length < 10 || d.length > 13) return null
  const semDdi = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d
  if (semDdi.length < 10 || semDdi.length > 11) return null
  return `55${semDdi}`
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const produto = await getProdutoPublico(id)
  if (!produto?.nome) {
    return Response.json({ error: 'produto não encontrado' }, { status: 404 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'dados inválidos' }, { status: 400 })
  }

  const quantidade = Math.round(Number((body as Record<string, unknown>).quantidade))
  const minimo = produto.pedidoMinimo ?? 1
  if (!Number.isFinite(quantidade) || quantidade < minimo) {
    return Response.json(
      { error: `a quantidade mínima para esta peça é ${minimo} peças` },
      { status: 400 },
    )
  }
  if (quantidade > 200000) {
    return Response.json({ error: 'quantidade fora do razoável' }, { status: 400 })
  }

  const nome = texto((body as Record<string, unknown>).nome, 80)
  const telefone = normalizarTelefone((body as Record<string, unknown>).telefone)
  const email = texto((body as Record<string, unknown>).email, 120)
  if (!nome || !telefone || !email || !email.includes('@')) {
    return Response.json({ error: 'preencha nome, WhatsApp e e-mail' }, { status: 400 })
  }

  const desde = new Date(Date.now() - JANELA_MIN * 60_000).toISOString()
  const { count } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id', { count: 'exact', head: true })
    .eq('telefone', telefone)
    .gte('criado_em', desde)
  if ((count ?? 0) >= MAX_POR_TELEFONE) {
    return Response.json(
      { error: 'você já enviou pedidos demais agora há pouco — aguarde um pouco' },
      { status: 429 },
    )
  }

  // "Recife/PE" ou "Recife - PE" → cidade + uf separados, como o resto do banco.
  const local = texto((body as Record<string, unknown>).cidade, 80)
  const partes = local ? local.split(/[/,-]/).map((p) => p.trim()) : []
  const cidade = partes[0] || null
  const uf = partes[1] && partes[1].length === 2 ? partes[1].toUpperCase() : null

  const tamanhos = texto((body as Record<string, unknown>).tamanhos, 200)
  const detalhes = texto((body as Record<string, unknown>).detalhes, 500)

  const linha = {
    modelo: produto.nome,
    material: produto.tecido ?? null,
    cor: null as string | null,
    total: quantidade,
    tamanhos: null,
    estampas: null,
    // O texto livre do cliente entra na descrição da linha: é o que o
    // fornecedor lê antes de orçar.
    descricao: [
      tamanhos ? `Tamanhos: ${tamanhos}` : null,
      detalhes,
      `Pedido feito pela vitrine (produto ${produto.id}).`,
    ]
      .filter(Boolean)
      .join(' · '),
  }

  const { data: pedido, error } = await supabaseAdmin
    .from('pedidos_assistente')
    .insert({
      linhas: [linha],
      categoria: produto.tipo ?? null,
      nome,
      telefone,
      email,
      cidade,
      uf,
      prazo_dias: produto.prazoDias ?? null,
      observacoes: `Pedido direto pela vitrine para ${produto.fornecedorNome ?? 'fornecedor'}.`,
      status: 'confirmado',
      confirmado_em: new Date().toISOString(),
      origem: 'vitrine_produto',
    })
    .select('id, codigo')
    .single()

  if (error || !pedido) {
    console.error('[produto/pedido] falha ao criar pedido:', error)
    return Response.json({ error: 'não consegui registrar seu pedido' }, { status: 500 })
  }

  // Oferta EXCLUSIVA pro dono do produto. Se a notificação falhar, o pedido já
  // está gravado e aparece no admin — melhor um pedido sem aviso do que um
  // cliente vendo erro depois de preencher tudo.
  const r = await ofertarPedido(pedido.id, [produto.fornecedorId]).catch((e) => {
    console.error('[produto/pedido] falha ao ofertar:', e)
    return { ok: false, criadas: 0, notificadas: 0, erro: 'falha ao notificar' }
  })
  if (!r.ok) console.error('[produto/pedido] oferta não criada:', r.erro)

  return Response.json({ ok: true, pedidoId: pedido.id, codigo: pedido.codigo })
}
