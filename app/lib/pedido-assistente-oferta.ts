// app/lib/pedido-assistente-oferta.ts
// ============================================================================
// Oferta de pedidos CONFIRMADOS (pedidos_assistente) a fornecedores escolhidos
// no admin. Modelo novo (jun/2026): o cliente confirma SEM preço; o fornecedor
// que aceitar recebe o contato do cliente + um link pra DEFINIR O ORÇAMENTO
// FINAL (líquido por produto + frete). O sistema converte pro preço do cliente
// (+3% de taxa embutida), avisa o cliente por e-mail e WhatsApp, e a cobrança
// só é gerada quando o cliente clica em pagar.
//
// Compat: pedidos pagos do fluxo antigo também aparecem na fila (legado).
// Privacidade: o contato do cliente NUNCA vai pro fornecedor antes do aceite.
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import { enviarMensagem } from './zapi'
import { SITE_URL, ofertaFornecedorUrl } from './url'
import { emailOfertaPedidoAssistente } from './email'
import { enviarEmailOrcamentoFinal } from './email-pedido'
import { atualizarValorCobrancaPix } from './pedido-pagamento'
import { calcularOrcamento, type PesquisaPreco } from './orcamento'

export const COMISSAO_PCT = 0.03

export type StatusOferta = 'ofertada' | 'aceita' | 'recusada' | 'cancelada'

export type LinhaPedido = {
  modelo?: string | null
  cor?: string | null
  material?: string | null
  total?: number | null
  tamanhos?: Array<{ tamanho?: string | null; qtd?: number | null }> | null
  estampas?: Array<{ posicao?: string | null; tamanho?: string | null }> | null
  descricao?: string | null
  preco_unit_centavos?: number | null // LÍQUIDO/un definido pelo fornecedor
}

export type PedidoPago = {
  id: string
  criado_em: string
  nome: string | null
  cep: string | null
  valor_centavos: number | null
  pagamento_status: string | null
  confirmado_em?: string | null
  orcamento_status?: string | null
  prazo_dias: number | null
  linhas: LinhaPedido[]
  ofertas: OfertaResumo[]
}

export type OfertaResumo = {
  id: string
  fornecedor_id: string
  fornecedor_nome: string | null
  fornecedor_whatsapp: string | null
  status: StatusOferta
  valor_repasse_centavos: number | null
  criado_em: string
  respondido_em: string | null
}

export type FornecedorOpcao = {
  id: string
  nome: string | null
  whatsapp: string | null
  cidade: string | null
  estado: string | null
  status: string | null
  tipos_produto: string[] | null
}

// 97% do total (Confeccione fica com 3%).
export function repasseFornecedor(valorCentavos: number | null | undefined): number | null {
  if (valorCentavos == null) return null
  const comissao = Math.round(valorCentavos * COMISSAO_PCT)
  return valorCentavos - comissao
}

/** Inverso: dado o LÍQUIDO do fornecedor, o preço do cliente (taxa embutida). */
export function precoClienteDeLiquido(liquidoCentavos: number): number {
  return Math.round(liquidoCentavos / (1 - COMISSAO_PCT))
}

function brl(centavos: number | null | undefined): string {
  if (centavos == null) return '—'
  return (centavos / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

function telBR(s: string | null | undefined): string {
  if (!s) return ''
  let d = s.replace(/\D/g, '')
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2)
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return s
}

// Resumo do pedido SEM dados de contato do cliente — usado na mensagem de
// WhatsApp ao fornecedor e nos cartões do admin.
export function resumirLinhas(linhas: LinhaPedido[]): { totalPecas: number; texto: string } {
  let totalPecas = 0
  const partes: string[] = []
  for (const l of linhas || []) {
    const qtd = typeof l.total === 'number' ? l.total : (l.tamanhos || []).reduce((s, t) => s + (t.qtd || 0), 0)
    totalPecas += qtd || 0
    const tamanhos = (l.tamanhos || [])
      .filter((t) => t.tamanho)
      .map((t) => `${t.tamanho}:${t.qtd ?? '?'}`)
      .join(' ')
    const estampado = (l.estampas?.length ?? 0) > 0 ? ' (estampado)' : ''
    const cor = l.cor ? ` ${l.cor}` : ''
    const material = l.material ? ` · ${l.material}` : ''
    partes.push(
      `• ${qtd || '?'}x ${l.modelo ?? 'peça'}${cor}${material}${estampado}` +
        (tamanhos ? `\n   tamanhos: ${tamanhos}` : '')
    )
  }
  return { totalPecas, texto: partes.join('\n') }
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Mesmo resumo, em HTML (pro e-mail) e texto puro.
export function resumirLinhasEmail(linhas: LinhaPedido[]): { totalPecas: number; html: string; texto: string } {
  let totalPecas = 0
  const htmlPartes: string[] = []
  const txtPartes: string[] = []
  for (const l of linhas || []) {
    const qtd = typeof l.total === 'number' ? l.total : (l.tamanhos || []).reduce((a, t) => a + (t.qtd || 0), 0)
    totalPecas += qtd || 0
    const tamanhos = (l.tamanhos || []).filter((t) => t.tamanho).map((t) => `${t.tamanho}:${t.qtd ?? '?'}`).join(' ')
    const estampado = (l.estampas?.length ?? 0) > 0 ? ' (estampado)' : ''
    const cor = l.cor ? ` ${l.cor}` : ''
    const material = l.material ? ` · ${l.material}` : ''
    const base = `${qtd || '?'}× ${l.modelo ?? 'peça'}${cor}${material}${estampado}`
    htmlPartes.push(`<div style=\"padding:4px 0;border-bottom:1px solid #f0f0f0;\">${escHtml(base)}${tamanhos ? `<br><span style=\"color:#888;font-size:13px;\">tamanhos: ${escHtml(tamanhos)}</span>` : ''}</div>`)
    txtPartes.push(`- ${base}${tamanhos ? ` (${tamanhos})` : ''}`)
  }
  return { totalPecas, html: htmlPartes.join(''), texto: txtPartes.join('\n') }
}

// Sugestão de preço (engine de mercado) pro pedido inteiro — usada quando o
// pedido ainda não tem valor (novo fluxo) pra estimar o repasse na oferta.
async function sugerirTotalCentavos(linhas: LinhaPedido[], prazoDias: number | null): Promise<number | null> {
  const { data: pesq } = await supabaseAdmin.from('pesquisas_preco').select('chave, faixas')
  const orc = calcularOrcamento(
    (linhas ?? []).map((l) => ({
      modelo: l.modelo ?? null,
      material: l.material ?? null,
      total: typeof l.total === 'number' ? l.total : (l.tamanhos || []).reduce((a, t) => a + (t.qtd || 0), 0) || null,
      estampas: (l.estampas ?? []).filter((e) => e.posicao && e.tamanho).map((e) => ({ posicao: String(e.posicao), tamanho: String(e.tamanho) })),
      estampado: (l.estampas?.length ?? 0) > 0,
    })),
    (pesq ?? []) as PesquisaPreco[],
    prazoDias
  )
  return orc.completo && orc.total_centavos > 0 ? orc.total_centavos : null
}

// ---------------------------------------------------------------------------
// Listagem: pedidos confirmados (+ pagos legados) + ofertas + fornecedores.
// ---------------------------------------------------------------------------
export async function listarPedidosPagos(): Promise<{
  pedidos: PedidoPago[]
  fornecedores: FornecedorOpcao[]
}> {
  const { data: pedidosRaw } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, criado_em, nome, cep, valor_centavos, pagamento_status, confirmado_em, orcamento_status, prazo_dias, linhas')
    .or('pagamento_status.eq.pago,confirmado_em.not.is.null,status.eq.completo')
    .order('criado_em', { ascending: false })

  const pedidos = (pedidosRaw ?? []) as Omit<PedidoPago, 'ofertas'>[]
  const ids = pedidos.map((p) => p.id)

  const ofertasPorPedido = new Map<string, OfertaResumo[]>()
  if (ids.length > 0) {
    const { data: ofertasRaw } = await supabaseAdmin
      .from('ofertas_pedido_assistente')
      .select(
        'id, pedido_id, fornecedor_id, status, valor_repasse_centavos, criado_em, respondido_em, leads_fornecedores(nome, whatsapp)'
      )
      .in('pedido_id', ids)
      .order('criado_em', { ascending: true })

    for (const o of (ofertasRaw ?? []) as any[]) {
      const lista = ofertasPorPedido.get(o.pedido_id) ?? []
      lista.push({
        id: o.id,
        fornecedor_id: o.fornecedor_id,
        fornecedor_nome: o.leads_fornecedores?.nome ?? null,
        fornecedor_whatsapp: o.leads_fornecedores?.whatsapp ?? null,
        status: o.status,
        valor_repasse_centavos: o.valor_repasse_centavos,
        criado_em: o.criado_em,
        respondido_em: o.respondido_em,
      })
      ofertasPorPedido.set(o.pedido_id, lista)
    }
  }

  // Todos os fornecedores (admin escolhe; inclui pausados — a pausa só
  // interrompe o disparo automático, não a escolha manual).
  const { data: fornRaw } = await supabaseAdmin
    .from('leads_fornecedores')
    .select('id, nome, whatsapp, cidade, estado, status, tipos_produto')
    .order('nome', { ascending: true })

  return {
    pedidos: pedidos.map((p) => ({
      ...p,
      linhas: Array.isArray(p.linhas) ? (p.linhas as LinhaPedido[]) : [],
      ofertas: ofertasPorPedido.get(p.id) ?? [],
    })),
    fornecedores: (fornRaw ?? []) as FornecedorOpcao[],
  }
}

// ---------------------------------------------------------------------------
// Ofertar: cria (ou reativa) ofertas pros fornecedores escolhidos e dispara
// WhatsApp. Idempotente por par (pedido,fornecedor).
// ---------------------------------------------------------------------------
export async function ofertarPedido(
  pedidoId: string,
  fornecedorIds: string[]
): Promise<{ ok: boolean; criadas: number; notificadas: number; erro?: string }> {
  const { data: pedido } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, pagamento_status, confirmado_em, valor_centavos, linhas, cep, imagens, prazo_dias')
    .eq('id', pedidoId)
    .maybeSingle<{
      id: string
      pagamento_status: string | null
      confirmado_em: string | null
      valor_centavos: number | null
      linhas: LinhaPedido[]
      cep: string | null
      imagens: unknown[] | null
      prazo_dias: number | null
    }>()

  if (!pedido) return { ok: false, criadas: 0, notificadas: 0, erro: 'Pedido não encontrado' }
  const pago = pedido.pagamento_status === 'pago'
  const linhas = Array.isArray(pedido.linhas) ? pedido.linhas : []
  // Oferta manual pelo admin é permitida em qualquer pedido com itens — não
  // exige pagamento/confirmação (o fornecedor define o orçamento final).
  if (linhas.length === 0) {
    return { ok: false, criadas: 0, notificadas: 0, erro: 'Pedido sem itens' }
  }

  // Repasse: pago → 97% do valor cobrado; confirmado → 97% do preço SUGERIDO
  // pela engine (estimativa — o fornecedor define o orçamento final).
  let baseCentavos = pago ? pedido.valor_centavos : null
  if (!baseCentavos || baseCentavos <= 0) {
    baseCentavos = await sugerirTotalCentavos(linhas, pedido.prazo_dias ?? null)
  }
  const repasse = repasseFornecedor(baseCentavos)
  const repasseTexto = pago ? brl(repasse) : repasse != null ? `~${brl(repasse)} (estimado)` : 'a definir por você'

  const { totalPecas, texto } = resumirLinhas(linhas)
  const emailLinhas = resumirLinhasEmail(linhas)
  const numImagens = Array.isArray(pedido.imagens) ? pedido.imagens.length : 0

  const { data: forns } = await supabaseAdmin
    .from('leads_fornecedores')
    .select('id, nome, whatsapp, email')
    .in('id', fornecedorIds)

  const fornById = new Map((forns ?? []).map((f: any) => [f.id, f]))

  let criadas = 0
  let notificadas = 0

  for (const fid of fornecedorIds) {
    const forn = fornById.get(fid)
    if (!forn) continue

    const { data: existente } = await supabaseAdmin
      .from('ofertas_pedido_assistente')
      .select('id, status')
      .eq('pedido_id', pedidoId)
      .eq('fornecedor_id', fid)
      .maybeSingle<{ id: string; status: StatusOferta }>()

    if (existente && existente.status === 'ofertada') continue

    let ofertaId: string
    if (existente) {
      const { error } = await supabaseAdmin
        .from('ofertas_pedido_assistente')
        .update({ status: 'ofertada', valor_repasse_centavos: repasse, respondido_em: null })
        .eq('id', existente.id)
      if (error) continue
      ofertaId = existente.id
    } else {
      const { data: nova, error } = await supabaseAdmin
        .from('ofertas_pedido_assistente')
        .insert({
          pedido_id: pedidoId,
          fornecedor_id: fid,
          status: 'ofertada',
          valor_repasse_centavos: repasse,
        })
        .select('id')
        .single()
      if (error || !nova) continue
      ofertaId = nova.id
    }
    criadas++

    const link = ofertaFornecedorUrl(ofertaId)

    // WhatsApp ao fornecedor — sem contato do cliente.
    if (forn.whatsapp) {
      const mensagem =
        `🧵 *Confeccione — pedido disponível*\n\n` +
        (pago
          ? `Um pedido *já pago* está disponível para produção:\n\n`
          : `Um pedido está disponível para você avaliar e assumir:\n\n`) +
        `${texto}\n\n` +
        `Total: *${totalPecas} peças*\n` +
        (pedido.prazo_dias ? `Prazo de produção: *${pedido.prazo_dias} dias* (a partir da confirmação do pagamento)\n` : '') +
        (pago
          ? `Valor total do pedido: *${repasseTexto}* (pagamento garantido pela Confeccione, liberado após a entrega em conformidade)\n\n`
          : `Repasse: *${repasseTexto}* — ao assumir, VOCÊ define o orçamento final (produtos + frete) e o cliente recebe pra aprovar. Pagamento garantido pela Confeccione, liberado após a entrega em conformidade.\n\n`) +
        `👉 Veja os mockups e detalhes e assuma o pedido aqui:\n${link}`
      const enviado = await enviarMensagem(forn.whatsapp, mensagem)
      if (enviado) notificadas++
    }

    // E-mail de oferta (best-effort; não bloqueia o fluxo)
    if (forn.email) {
      try {
        await emailOfertaPedidoAssistente({
          email: forn.email,
          nomeFornecedor: forn.nome ?? null,
          totalPecas: emailLinhas.totalPecas,
          linhasHtml: emailLinhas.html,
          linhasTexto: emailLinhas.texto,
          repasseTexto,
          pago,
          linkOferta: link,
          numImagens,
          prazoDias: pedido.prazo_dias ?? null,
        })
      } catch (e) {
        console.error('[oferta] e-mail falhou', fid, e)
      }
    }
  }

  return { ok: true, criadas, notificadas }
}

// ---------------------------------------------------------------------------
// Aceite: notifica o fornecedor com o CONTATO DO CLIENTE + link do orçamento.
// ---------------------------------------------------------------------------
async function notificarFornecedorAceite(ofertaId: string, pedidoId: string, fornecedorId: string): Promise<void> {
  try {
    const [{ data: forn }, { data: pedido }] = await Promise.all([
      supabaseAdmin.from('leads_fornecedores').select('nome, whatsapp').eq('id', fornecedorId).maybeSingle<{ nome: string | null; whatsapp: string | null }>(),
      supabaseAdmin.from('pedidos_assistente').select('nome, telefone, email, cidade, uf, pagamento_status').eq('id', pedidoId).maybeSingle<{ nome: string | null; telefone: string | null; email: string | null; cidade: string | null; uf: string | null; pagamento_status: string | null }>(),
    ])
    if (!forn?.whatsapp || !pedido) return

    const linkOrcamento = `${SITE_URL}/fornecedor/oferta/${ofertaId}/orcamento`
    const local = [pedido.cidade, pedido.uf].filter(Boolean).join('/')
    const mensagem =
      `🎉 *Pedido confirmado pra você!*\n\n` +
      `Contato do cliente pra combinar os detalhes:\n` +
      `👤 ${pedido.nome ?? 'Cliente Confeccione'}\n` +
      (pedido.telefone ? `📱 ${telBR(pedido.telefone)}\n` : '') +
      (pedido.email ? `✉️ ${pedido.email}\n` : '') +
      (local ? `📍 ${local}\n` : '') +
      (pedido.pagamento_status === 'pago'
        ? `\n✅ Este pedido já está pago — pode iniciar a produção.`
        : `\n💰 *Agora defina o orçamento final* (seu valor por produto + frete). O cliente recebe por e-mail e WhatsApp pra aprovar e pagar:\n${linkOrcamento}`)
    await enviarMensagem(forn.whatsapp, mensagem)
  } catch (e) {
    console.error('[oferta] notificação de aceite falhou', ofertaId, e)
  }
}

// ---------------------------------------------------------------------------
// Marcar status de uma oferta. Ao aceitar: cancela as demais em aberto, marca
// o pedido como aguardando orçamento e notifica o fornecedor com o contato.
// ---------------------------------------------------------------------------
export async function definirStatusOferta(
  ofertaId: string,
  novoStatus: Extract<StatusOferta, 'aceita' | 'recusada' | 'cancelada'>
): Promise<{ ok: boolean; erro?: string }> {
  const { data: oferta } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('id, pedido_id, fornecedor_id')
    .eq('id', ofertaId)
    .maybeSingle<{ id: string; pedido_id: string; fornecedor_id: string }>()

  if (!oferta) return { ok: false, erro: 'Oferta não encontrada' }

  const { error } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .update({ status: novoStatus, respondido_em: new Date().toISOString() })
    .eq('id', ofertaId)
  if (error) return { ok: false, erro: error.message }

  if (novoStatus === 'aceita') {
    // cancela as outras ofertas ainda em aberto do mesmo pedido
    await supabaseAdmin
      .from('ofertas_pedido_assistente')
      .update({ status: 'cancelada', respondido_em: new Date().toISOString() })
      .eq('pedido_id', oferta.pedido_id)
      .eq('status', 'ofertada')
      .neq('id', ofertaId)

    // novo fluxo: pedido fica aguardando o orçamento do fornecedor
    const { data: ped } = await supabaseAdmin
      .from('pedidos_assistente')
      .select('pagamento_status, orcamento_status')
      .eq('id', oferta.pedido_id)
      .maybeSingle<{ pagamento_status: string | null; orcamento_status: string | null }>()
    if (ped && ped.pagamento_status !== 'pago' && !ped.orcamento_status) {
      await supabaseAdmin
        .from('pedidos_assistente')
        .update({ orcamento_status: 'aguardando_fornecedor', atualizado_em: new Date().toISOString() })
        .eq('id', oferta.pedido_id)
    }

    await notificarFornecedorAceite(ofertaId, oferta.pedido_id, oferta.fornecedor_id)
  }

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Carrega a oferta pra a PÁGINA DO FORNECEDOR. Antes do aceite, SEM contato
// do cliente; depois do aceite, com contato + link do orçamento.
// ---------------------------------------------------------------------------
export type ContatoClienteOferta = {
  nome: string | null
  telefone: string | null
  email: string | null
  cidade: string | null
  uf: string | null
}

export type OfertaDetalheFornecedor = {
  ofertaId: string
  pedidoId: string
  status: StatusOferta
  fornecedorNome: string | null
  totalPecas: number
  linhas: LinhaPedido[]
  numImagens: number
  valorRepasseCentavos: number | null
  prazoDias: number | null
  cidade: string | null
  uf: string | null
  pago: boolean
  orcamentoStatus: string | null
  contatoCliente: ContatoClienteOferta | null
  linkOrcamento: string | null
}

export async function carregarOfertaParaFornecedor(
  ofertaId: string
): Promise<OfertaDetalheFornecedor | null> {
  const { data: oferta } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('id, pedido_id, status, valor_repasse_centavos, leads_fornecedores(nome)')
    .eq('id', ofertaId)
    .maybeSingle<any>()
  if (!oferta) return null

  const { data: pedido } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, linhas, imagens, pagamento_status, orcamento_status, prazo_dias, nome, telefone, email, cidade, uf')
    .eq('id', oferta.pedido_id)
    .maybeSingle<{
      id: string
      linhas: LinhaPedido[]
      imagens: unknown[] | null
      pagamento_status: string | null
      orcamento_status: string | null
      prazo_dias: number | null
      nome: string | null
      telefone: string | null
      email: string | null
      cidade: string | null
      uf: string | null
    }>()
  if (!pedido) return null

  const linhas = Array.isArray(pedido.linhas) ? pedido.linhas : []
  const { totalPecas } = resumirLinhas(linhas)
  const aceita = oferta.status === 'aceita'

  return {
    ofertaId: oferta.id,
    pedidoId: pedido.id,
    status: oferta.status,
    fornecedorNome: oferta.leads_fornecedores?.nome ?? null,
    totalPecas,
    linhas,
    numImagens: Array.isArray(pedido.imagens) ? pedido.imagens.length : 0,
    valorRepasseCentavos: oferta.valor_repasse_centavos,
    prazoDias: pedido.prazo_dias ?? null,
    cidade: pedido.cidade ?? null,
    uf: pedido.uf ?? null,
    pago: pedido.pagamento_status === 'pago',
    orcamentoStatus: pedido.orcamento_status ?? null,
    contatoCliente: pedido.pagamento_status === 'pago'
      ? { nome: pedido.nome, telefone: pedido.telefone, email: pedido.email, cidade: pedido.cidade, uf: pedido.uf }
      : null,
    linkOrcamento: aceita ? `/fornecedor/oferta/${oferta.id}/orcamento` : null,
  }
}

// Resposta do fornecedor pela página pública (aceitar/recusar). Só atua se a
// oferta ainda estiver 'ofertada'.
export async function responderOfertaFornecedor(
  ofertaId: string,
  acao: 'aceitar' | 'recusar'
): Promise<{ ok: boolean; status?: StatusOferta; erro?: string }> {
  const { data: oferta } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('id, status')
    .eq('id', ofertaId)
    .maybeSingle<{ id: string; status: StatusOferta }>()
  if (!oferta) return { ok: false, erro: 'Oferta não encontrada' }
  if (oferta.status !== 'ofertada') {
    return { ok: false, status: oferta.status, erro: 'Esta oferta já foi respondida.' }
  }
  const novo = acao === 'aceitar' ? 'aceita' : 'recusada'
  const r = await definirStatusOferta(ofertaId, novo)
  if (!r.ok) return { ok: false, erro: r.erro }
  return { ok: true, status: novo }
}

// ---------------------------------------------------------------------------
// ORÇAMENTO DO FORNECEDOR — página pública por uuid da oferta (aceita).
// O fornecedor informa o LÍQUIDO dele por produto + frete; o sistema converte
// pro preço do cliente (+3% embutido) e avisa o cliente (e-mail + WhatsApp).
// ---------------------------------------------------------------------------
export type ItemOrcamentoFornecedor = {
  label: string
  qtd: number
  unitLiquidoAtualCentavos: number | null
  unitLiquidoSugeridoCentavos: number | null
}

export type OrcamentoFornecedorDados = {
  ofertaId: string
  pedidoId: string
  fornecedorNome: string | null
  clienteNome: string | null
  prazoDias: number | null
  itens: ItemOrcamentoFornecedor[]
  freteLiquidoAtualCentavos: number | null
  jaDefinido: boolean
  pago: boolean
  definidoEm: string | null
}

function qtdDaLinha(l: LinhaPedido): number {
  return typeof l.total === 'number' && l.total > 0
    ? l.total
    : (l.tamanhos || []).reduce((a, t) => a + (t.qtd || 0), 0)
}

export async function carregarOrcamentoFornecedor(ofertaId: string): Promise<OrcamentoFornecedorDados | null> {
  const { data: oferta } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('id, pedido_id, status, leads_fornecedores(nome)')
    .eq('id', ofertaId)
    .maybeSingle<any>()
  if (!oferta || oferta.status !== 'aceita') return null

  const { data: pedido } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, nome, linhas, prazo_dias, pagamento_status, orcamento_status, orcamento_definido_em, frete_centavos')
    .eq('id', oferta.pedido_id)
    .maybeSingle<{
      id: string
      nome: string | null
      linhas: LinhaPedido[]
      prazo_dias: number | null
      pagamento_status: string | null
      orcamento_status: string | null
      orcamento_definido_em: string | null
      frete_centavos: number | null
    }>()
  if (!pedido) return null

  const linhas = Array.isArray(pedido.linhas) ? pedido.linhas : []

  // sugeridos: engine de mercado → líquido (97% do unitário sugerido ao cliente)
  const { data: pesq } = await supabaseAdmin.from('pesquisas_preco').select('chave, faixas')
  const orc = calcularOrcamento(
    linhas.map((l) => ({
      modelo: l.modelo ?? null,
      material: l.material ?? null,
      total: qtdDaLinha(l) || null,
      estampas: (l.estampas ?? []).filter((e) => e.posicao && e.tamanho).map((e) => ({ posicao: String(e.posicao), tamanho: String(e.tamanho) })),
      estampado: (l.estampas?.length ?? 0) > 0,
    })),
    (pesq ?? []) as PesquisaPreco[],
    pedido.prazo_dias ?? null
  )

  const itens: ItemOrcamentoFornecedor[] = linhas.map((l, i) => {
    const unitSugeridoCliente = orc.linhas?.[i]?.unit_centavos ?? null
    return {
      label: [qtdDaLinha(l) || '?', '×', l.modelo ?? 'peça', l.cor ?? '', l.material ? `· ${l.material}` : ''].join(' ').replace(/\s+/g, ' ').trim(),
      qtd: qtdDaLinha(l),
      unitLiquidoAtualCentavos: l.preco_unit_centavos ?? null,
      unitLiquidoSugeridoCentavos: unitSugeridoCliente != null ? Math.round(unitSugeridoCliente * (1 - COMISSAO_PCT)) : null,
    }
  })

  const jaDefinido = pedido.orcamento_status === 'definido'

  return {
    ofertaId: oferta.id,
    pedidoId: pedido.id,
    fornecedorNome: oferta.leads_fornecedores?.nome ?? null,
    clienteNome: pedido.nome,
    prazoDias: pedido.prazo_dias ?? null,
    itens,
    freteLiquidoAtualCentavos:
      jaDefinido && pedido.frete_centavos != null ? Math.round(pedido.frete_centavos * (1 - COMISSAO_PCT)) : null,
    jaDefinido,
    pago: pedido.pagamento_status === 'pago',
    definidoEm: pedido.orcamento_definido_em ?? null,
  }
}

export async function salvarOrcamentoFornecedor(
  ofertaId: string,
  unitLiquidoCentavos: number[],
  freteLiquidoCentavos: number
): Promise<{ ok: boolean; erro?: string; valorClienteCentavos?: number; repasseCentavos?: number }> {
  const { data: oferta } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('id, pedido_id, status, leads_fornecedores(nome)')
    .eq('id', ofertaId)
    .maybeSingle<any>()
  if (!oferta || oferta.status !== 'aceita') return { ok: false, erro: 'Oferta não encontrada ou não aceita.' }

  const { data: pedido } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, nome, telefone, email, linhas, pagamento_status, asaas_payment_id, valor_centavos')
    .eq('id', oferta.pedido_id)
    .maybeSingle<{
      id: string
      nome: string | null
      telefone: string | null
      email: string | null
      linhas: LinhaPedido[]
      pagamento_status: string | null
      asaas_payment_id: string | null
      valor_centavos: number | null
    }>()
  if (!pedido) return { ok: false, erro: 'Pedido não encontrado.' }
  if (pedido.pagamento_status === 'pago') return { ok: false, erro: 'Este pedido já foi pago — o orçamento não pode mais ser alterado.' }

  const linhas = Array.isArray(pedido.linhas) ? pedido.linhas : []
  if (linhas.length === 0 || unitLiquidoCentavos.length !== linhas.length) {
    return { ok: false, erro: 'Valores não conferem com os itens do pedido.' }
  }
  if (unitLiquidoCentavos.some((v) => !Number.isInteger(v) || v <= 0)) {
    return { ok: false, erro: 'Informe um valor unitário válido pra cada item.' }
  }
  if (!Number.isInteger(freteLiquidoCentavos) || freteLiquidoCentavos < 0) {
    return { ok: false, erro: 'Frete inválido.' }
  }

  let produtosLiquido = 0
  const linhasNovas = linhas.map((l, i) => {
    const qtd = qtdDaLinha(l)
    produtosLiquido += qtd * unitLiquidoCentavos[i]
    return { ...l, preco_unit_centavos: unitLiquidoCentavos[i] }
  })
  const totalLiquido = produtosLiquido + freteLiquidoCentavos
  if (totalLiquido <= 0) return { ok: false, erro: 'Orçamento zerado.' }

  const valorCliente = precoClienteDeLiquido(totalLiquido)
  const freteCliente = freteLiquidoCentavos > 0 ? precoClienteDeLiquido(freteLiquidoCentavos) : 0
  const agora = new Date().toISOString()

  const { error: errUpd } = await supabaseAdmin
    .from('pedidos_assistente')
    .update({
      linhas: linhasNovas,
      valor_centavos: valorCliente,
      frete_centavos: freteCliente,
      repasse_centavos: totalLiquido,
      orcamento_status: 'definido',
      orcamento_definido_em: agora,
      atualizado_em: agora,
    })
    .eq('id', pedido.id)
  if (errUpd) return { ok: false, erro: 'Não foi possível salvar o orçamento.' }

  await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .update({ valor_repasse_centavos: totalLiquido })
    .eq('id', ofertaId)

  // cobrança já gerada (não paga) com valor antigo → atualiza no ASAAS
  if (pedido.asaas_payment_id && pedido.valor_centavos !== valorCliente) {
    try {
      const upd = await atualizarValorCobrancaPix(pedido.asaas_payment_id, valorCliente)
      await supabaseAdmin
        .from('pedidos_assistente')
        .update({ pix_copia_cola: upd.copiaCola, pix_qr_imagem: upd.qrImagem, pix_link: upd.invoiceUrl })
        .eq('id', pedido.id)
    } catch (e) {
      console.error('[orcamento-fornecedor] atualização da cobrança falhou', e)
    }
  }

  const fornecedorNome: string | null = oferta.leads_fornecedores?.nome ?? null

  // notifica o cliente — e-mail + WhatsApp (best-effort)
  if (pedido.email) {
    try {
      await enviarEmailOrcamentoFinal({
        id: pedido.id,
        email: pedido.email,
        nome: pedido.nome,
        fornecedorNome,
        totalCentavos: valorCliente,
        freteCentavos: freteCliente,
        linhas: linhasNovas.map((l) => ({
          modelo: l.modelo ?? null,
          cor: l.cor ?? null,
          material: l.material ?? null,
          total: l.total ?? null,
          tamanhos: (l.tamanhos ?? []).filter((t) => t.tamanho).map((t) => ({ tamanho: String(t.tamanho), qtd: t.qtd ?? null })),
          estampas: (l.estampas ?? []).filter((e) => e.posicao && e.tamanho).map((e) => ({ posicao: String(e.posicao), tamanho: String(e.tamanho) })),
        })),
      })
    } catch (e) {
      console.error('[orcamento-fornecedor] e-mail ao cliente falhou', e)
    }
  }
  if (pedido.telefone) {
    try {
      const msg =
        `🎉 Oi${pedido.nome ? ', ' + pedido.nome.split(' ')[0] : ''}! Seu orçamento na Confeccione saiu!\n\n` +
        (fornecedorNome ? `O fornecedor *${fornecedorNome}* vai atender seu pedido.\n` : '') +
        `💰 Total: *${brl(valorCliente)}*` +
        (freteCliente > 0 ? ` (produtos ${brl(valorCliente - freteCliente)} + frete ${brl(freteCliente)})` : ' (frete incluso)') +
        `\n\nVeja os detalhes e finalize o pagamento (PIX ou cartão):\n${SITE_URL}/visualizador/${pedido.id}`
      await enviarMensagem(pedido.telefone, msg)
    } catch (e) {
      console.error('[orcamento-fornecedor] WhatsApp ao cliente falhou', e)
    }
  }

  return { ok: true, valorClienteCentavos: valorCliente, repasseCentavos: totalLiquido }
}
