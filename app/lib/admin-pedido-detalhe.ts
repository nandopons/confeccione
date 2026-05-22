// app/lib/admin-pedido-detalhe.ts
// ============================================================================
// Casa ÚNICA dos loaders de detalhe de pedido (modal admin). Server-side
// (supabaseAdmin). Consumido pela aba /admin/pedidos (qualquer aba que mostre
// o 👁 Detalhes). Extraído de orfaos/page.tsx (que virou redirect) — sem
// duplicação: aqui é a fonte; lá não existe mais.
// ============================================================================

import { supabaseAdmin } from '@/app/lib/supabase-server'
import { temCreditoDisponivel, type Plano } from '@/app/lib/planos'

export type OfertaHistorico = {
  id: string
  fornecedor_id: string
  /** enviada | aceita | recusada | recusada_sem_credito | expirada |
   *  expirada_sem_credito. String pra aceitar valores novos (fallback no modal). */
  status: string
  enviada_em: string
  respondida_em: string | null
  fornecedor_nome: string
}

/** Dados base de QUALQUER pedido — o que o modal de detalhes precisa. */
export type PedidoDetalhe = {
  pedido_id: string
  tipo: string
  quantidade: number | null
  estado: string
  nome: string
  whatsapp: string
  email: string | null
  prazo: string | null
  descricao: string | null
  pedido_status: string
  pedido_criado_em: string
}

/** Pacote de apoio do modal pra um conjunto de pedidos (uma aba). */
export type DadosDetalhe = {
  pedidoDetalhe: Map<string, PedidoDetalhe>
  ofertasPorPedido: Map<string, OfertaHistorico[]>
  agendadasPorFornecedor: Map<string, number>
  paresJaAgendados: Set<string>
  temCreditoPorFornecedor: Map<string, boolean>
}

/** Orquestrador: carrega tudo que o modal precisa pros pedidos de uma aba.
 *  Ponto de entrada único pra /admin/pedidos. */
export async function carregarDadosDetalhe(
  pedidoIds: string[]
): Promise<DadosDetalhe> {
  const vazio: DadosDetalhe = {
    pedidoDetalhe: new Map(),
    ofertasPorPedido: new Map(),
    agendadasPorFornecedor: new Map(),
    paresJaAgendados: new Set(),
    temCreditoPorFornecedor: new Map(),
  }
  if (pedidoIds.length === 0) return vazio

  // Detalhe do pedido + histórico de ofertas em paralelo
  const [pedidoDetalhe, ofertasPorPedido] = await Promise.all([
    carregarPedidoDetalhe(pedidoIds),
    carregarHistoricoOfertas(pedidoIds),
  ])

  // Fornecedores únicos do histórico → estado da fila + crédito
  const fornecedorIdsUnicos = Array.from(
    new Set(
      Array.from(ofertasPorPedido.values())
        .flat()
        .map((o) => o.fornecedor_id)
    )
  )
  const [estadoFila, temCreditoPorFornecedor] = await Promise.all([
    carregarEstadoFila(),
    carregarTemCreditoPorFornecedor(fornecedorIdsUnicos),
  ])

  return {
    pedidoDetalhe,
    ofertasPorPedido,
    agendadasPorFornecedor: estadoFila.agendadasPorFornecedor,
    paresJaAgendados: estadoFila.paresJaAgendados,
    temCreditoPorFornecedor,
  }
}

async function carregarPedidoDetalhe(
  pedidoIds: string[]
): Promise<Map<string, PedidoDetalhe>> {
  const mapa = new Map<string, PedidoDetalhe>()
  if (pedidoIds.length === 0) return mapa

  const { data } = await supabaseAdmin
    .from('pedidos')
    .select(
      'id, tipo, quantidade, estado, nome, whatsapp, email, prazo, descricao, status, criado_em'
    )
    .in('id', pedidoIds)

  const pedidos = (data ?? []) as Array<{
    id: string
    tipo: string
    quantidade: number | null
    estado: string
    nome: string
    whatsapp: string
    email: string | null
    prazo: string | null
    descricao: string | null
    status: string
    criado_em: string
  }>

  for (const p of pedidos) {
    mapa.set(p.id, {
      pedido_id: p.id,
      tipo: p.tipo,
      quantidade: p.quantidade,
      estado: p.estado,
      nome: p.nome,
      whatsapp: p.whatsapp,
      email: p.email,
      prazo: p.prazo,
      descricao: p.descricao,
      pedido_status: p.status,
      pedido_criado_em: p.criado_em,
    })
  }
  return mapa
}

async function carregarHistoricoOfertas(
  pedidoIds: string[]
): Promise<Map<string, OfertaHistorico[]>> {
  const mapa = new Map<string, OfertaHistorico[]>()
  if (pedidoIds.length === 0) return mapa

  const { data: ofertasRaw } = await supabaseAdmin
    .from('ofertas')
    .select('id, pedido_id, fornecedor_id, status, enviada_em, respondida_em')
    .in('pedido_id', pedidoIds)
    .order('enviada_em', { ascending: true })

  const ofertas = (ofertasRaw ?? []) as Array<{
    id: string
    pedido_id: string
    fornecedor_id: string
    status: string
    enviada_em: string
    respondida_em: string | null
  }>
  if (ofertas.length === 0) return mapa

  const fornecedorIds = Array.from(
    new Set(ofertas.map((o) => o.fornecedor_id))
  )
  const { data: fornecedoresRaw } = await supabaseAdmin
    .from('leads_fornecedores')
    .select('id, nome')
    .in('id', fornecedorIds)

  const fornecedorMap = new Map(
    ((fornecedoresRaw ?? []) as Array<{ id: string; nome: string }>).map(
      (f) => [f.id, f.nome]
    )
  )

  for (const o of ofertas) {
    const lista = mapa.get(o.pedido_id) ?? []
    lista.push({
      id: o.id,
      fornecedor_id: o.fornecedor_id,
      status: o.status,
      enviada_em: o.enviada_em,
      respondida_em: o.respondida_em,
      fornecedor_nome: fornecedorMap.get(o.fornecedor_id) ?? '—',
    })
    mapa.set(o.pedido_id, lista)
  }
  return mapa
}

/** Estado da fila de reenvios (ofertas_agendadas pendentes):
 *  - agendadasPorFornecedor: count por fornecedor (indicador "(N na fila)")
 *  - paresJaAgendados: chaves `${pedido_id}:${fornecedor_id}` pendentes */
async function carregarEstadoFila(): Promise<{
  agendadasPorFornecedor: Map<string, number>
  paresJaAgendados: Set<string>
}> {
  const { data } = await supabaseAdmin
    .from('ofertas_agendadas')
    .select('pedido_id, fornecedor_id')
    .is('processada_em', null)

  const linhas = (data ?? []) as Array<{
    pedido_id: string
    fornecedor_id: string
  }>

  const agendadasPorFornecedor = new Map<string, number>()
  const paresJaAgendados = new Set<string>()
  for (const a of linhas) {
    agendadasPorFornecedor.set(
      a.fornecedor_id,
      (agendadasPorFornecedor.get(a.fornecedor_id) ?? 0) + 1
    )
    paresJaAgendados.add(`${a.pedido_id}:${a.fornecedor_id}`)
  }
  return { agendadasPorFornecedor, paresJaAgendados }
}

/** tem_credito por fornecedor (1 SELECT plano + N contarOfertasMesAtual em
 *  paralelo). Dívida: batch quando vol crescer (1 query GROUP BY). */
async function carregarTemCreditoPorFornecedor(
  fornecedorIds: string[]
): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>()
  if (fornecedorIds.length === 0) return map

  const { data } = await supabaseAdmin
    .from('leads_fornecedores')
    .select('id, plano, plano_expira_em, plano_ativado_em, creditos_extras')
    .in('id', fornecedorIds)

  const fornecedores = (data ?? []) as Array<{
    id: string
    plano: Plano
    plano_expira_em: string | null
    plano_ativado_em: string | null
    creditos_extras: number
  }>

  const entries = await Promise.all(
    fornecedores.map(async (f) => {
      const r = await temCreditoDisponivel(f)
      return [f.id, r.tem_credito] as const
    })
  )
  for (const [id, tem] of entries) map.set(id, tem)
  return map
}
