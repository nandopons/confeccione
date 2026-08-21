// app/lib/producao.ts
// ============================================================================
// CRM de produção — o pedaço que faltava entre "cliente pagou" e "finalizado".
//
// O QUE ESTE ARQUIVO É
// A fonte da verdade das etapas de fábrica e das três operações que o quadro
// precisa: montar o quadro, mover um card e ler a linha do tempo de um pedido.
// Admin e painel do fornecedor consomem daqui — não duplicam regra.
//
// QUEM PRODUZ
// O fornecedor parceiro, não a Confeccione. Então este quadro é instrumento de
// ACOMPANHAMENTO: o admin vê tudo e move qualquer card; o fornecedor move só
// os pedidos dele. Cada movimento grava quem foi.
//
// SÓ PEDIDO PAGO ENTRA
// Antes do pagamento o pedido ainda é comercial (orçamento, aceite, cobrança) —
// e o próprio sistema diz ao fornecedor para não começar antes de pagar. Um
// card de algo que não pode ser produzido só polui o quadro.
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import { resumirLinhas, type LinhaPedido } from './pedido-assistente-oferta'
import { ehEtapa, type Etapa } from './producao-etapas'

// As etapas moram em producao-etapas.ts, sem import de servidor, porque o
// componente cliente do painel do fornecedor precisa da lista — e importar
// deste arquivo arrastaria o supabaseAdmin (service role) pro bundle.
// Reexporta pra quem já lê daqui não precisar saber da divisão.
export { ETAPAS, ehEtapa, tituloEtapa, type Etapa } from './producao-etapas'

export type CardProducao = {
  pedidoId: string
  etapa: Etapa
  entrouEtapaEm: string
  observacao: string | null
  // Do pedido
  clienteNome: string | null
  totalPecas: number
  resumo: string
  valorCentavos: number | null
  repasseCentavos: number | null
  prazoDias: number | null
  pagoEm: string | null
  criadoEm: string
  // Do fornecedor que assumiu
  fornecedorId: string | null
  fornecedorNome: string | null
  // Derivado
  diasNaEtapa: number
}

export type EventoProducao = {
  id: string
  deEtapa: string | null
  paraEtapa: string
  autor: string
  autorNome: string | null
  observacao: string | null
  criadoEm: string
}

type LinhaPedidoRow = {
  id: string
  nome: string | null
  linhas: LinhaPedido[] | null
  valor_centavos: number | null
  repasse_centavos: number | null
  prazo_dias: number | null
  criado_em: string
  atualizado_em: string | null
  pagamento_status: string | null
  finalizado_em: string | null
}

function dias(desde: string): number {
  const ms = Date.now() - new Date(desde).getTime()
  return Math.max(0, Math.floor(ms / 86_400_000))
}

/**
 * Monta o quadro inteiro.
 *
 * Cria a linha de produção sob demanda: qualquer pedido pago e não finalizado
 * que ainda não tenha card entra em `planejamento`, com um evento de autor
 * 'sistema'. Isso é o que faz os pedidos que JÁ estavam pagos antes desta
 * funcionalidade existir aparecerem sem migração de dados.
 *
 * `fornecedorId` restringe ao que aquele fornecedor assumiu — é assim que o
 * painel dele reusa esta mesma função sem ver pedido de terceiro.
 */
export async function carregarQuadro(fornecedorId?: string): Promise<CardProducao[]> {
  const { data: pedidosData } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, nome, linhas, valor_centavos, repasse_centavos, prazo_dias, criado_em, atualizado_em, pagamento_status, finalizado_em')
    .eq('pagamento_status', 'pago')
    .is('finalizado_em', null)
    .order('criado_em', { ascending: true })

  const pedidos = (pedidosData ?? []) as unknown as LinhaPedidoRow[]
  if (!pedidos.length) return []

  const ids = pedidos.map((p) => p.id)

  // Fornecedor que assumiu cada pedido
  const { data: ofertasData } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('pedido_id, fornecedor_id, leads_fornecedores(nome)')
    .in('pedido_id', ids)
    .eq('status', 'aceita')

  const porPedidoFornecedor = new Map<string, { id: string; nome: string | null }>()
  for (const o of (ofertasData ?? []) as unknown as {
    pedido_id: string
    fornecedor_id: string
    leads_fornecedores: { nome: string | null } | null
  }[]) {
    porPedidoFornecedor.set(o.pedido_id, {
      id: o.fornecedor_id,
      nome: o.leads_fornecedores?.nome ?? null,
    })
  }

  // Filtro do painel do fornecedor: só o que é dele.
  const visiveis = fornecedorId
    ? pedidos.filter((p) => porPedidoFornecedor.get(p.id)?.id === fornecedorId)
    : pedidos
  if (!visiveis.length) return []

  const idsVisiveis = visiveis.map((p) => p.id)

  const { data: prodData } = await supabaseAdmin
    .from('producao_pedido')
    .select('pedido_id, etapa, entrou_etapa_em, observacao')
    .in('pedido_id', idsVisiveis)

  const producao = new Map<string, { etapa: Etapa; entrou_etapa_em: string; observacao: string | null }>()
  for (const r of (prodData ?? []) as unknown as {
    pedido_id: string
    etapa: Etapa
    entrou_etapa_em: string
    observacao: string | null
  }[]) {
    producao.set(r.pedido_id, r)
  }

  // Backfill: pedido pago sem card ainda.
  const faltando = idsVisiveis.filter((id) => !producao.has(id))
  if (faltando.length) {
    const agora = new Date().toISOString()
    await supabaseAdmin.from('producao_pedido').insert(
      faltando.map((pedido_id) => ({ pedido_id, etapa: 'planejamento', entrou_etapa_em: agora })),
    )
    await supabaseAdmin.from('producao_eventos').insert(
      faltando.map((pedido_id) => ({
        pedido_id,
        de_etapa: null,
        para_etapa: 'planejamento',
        autor: 'sistema',
        observacao: 'Pagamento confirmado — entrou na fila de produção',
      })),
    )
    for (const id of faltando) {
      producao.set(id, { etapa: 'planejamento', entrou_etapa_em: agora, observacao: null })
    }
  }

  return visiveis.map((p) => {
    const prod = producao.get(p.id)!
    const linhas = Array.isArray(p.linhas) ? p.linhas : []
    const { totalPecas, texto } = resumirLinhas(linhas)
    const forn = porPedidoFornecedor.get(p.id) ?? null
    return {
      pedidoId: p.id,
      etapa: prod.etapa,
      entrouEtapaEm: prod.entrou_etapa_em,
      observacao: prod.observacao,
      clienteNome: p.nome,
      totalPecas,
      resumo: texto,
      valorCentavos: p.valor_centavos,
      repasseCentavos: p.repasse_centavos,
      prazoDias: p.prazo_dias ?? null,
      pagoEm: p.atualizado_em ?? null,
      criadoEm: p.criado_em,
      fornecedorId: forn?.id ?? null,
      fornecedorNome: forn?.nome ?? null,
      diasNaEtapa: dias(prod.entrou_etapa_em),
    }
  })
}

export type ResultadoMover =
  | { ok: true; etapa: Etapa }
  | { ok: false; erro: string }

/**
 * Move um card de etapa e registra o evento.
 *
 * Aceita movimento para trás de propósito: produção volta — peça sai da costura
 * e retorna pra estamparia porque a estampa falhou. Travar só a frente
 * transformaria o quadro em mentira.
 *
 * `entrou_etapa_em` só é reescrito quando a etapa muda de fato. Salvar só a
 * observação não pode zerar o contador de "parado há N dias".
 */
export async function moverEtapa(params: {
  pedidoId: string
  etapa: Etapa
  autor: 'admin' | 'fornecedor'
  autorId?: string | null
  autorNome?: string | null
  observacao?: string | null
  // Quando presente, exige que o pedido seja deste fornecedor.
  exigirFornecedorId?: string
}): Promise<ResultadoMover> {
  if (!ehEtapa(params.etapa)) return { ok: false, erro: 'Etapa desconhecida' }

  const { data: pedido } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, pagamento_status, finalizado_em')
    .eq('id', params.pedidoId)
    .maybeSingle()

  if (!pedido) return { ok: false, erro: 'Pedido não encontrado' }
  if (pedido.pagamento_status !== 'pago') {
    return { ok: false, erro: 'Pedido ainda não foi pago' }
  }

  if (params.exigirFornecedorId) {
    const { data: oferta } = await supabaseAdmin
      .from('ofertas_pedido_assistente')
      .select('id')
      .eq('pedido_id', params.pedidoId)
      .eq('fornecedor_id', params.exigirFornecedorId)
      .eq('status', 'aceita')
      .maybeSingle()
    if (!oferta) return { ok: false, erro: 'Este pedido não é seu' }
  }

  const { data: atual } = await supabaseAdmin
    .from('producao_pedido')
    .select('etapa')
    .eq('pedido_id', params.pedidoId)
    .maybeSingle()

  const de = (atual?.etapa as Etapa | undefined) ?? null
  const mudou = de !== params.etapa
  const agora = new Date().toISOString()

  const patch: Record<string, unknown> = {
    pedido_id: params.pedidoId,
    etapa: params.etapa,
    atualizado_em: agora,
  }
  if (mudou) patch.entrou_etapa_em = agora
  if (params.observacao !== undefined) patch.observacao = params.observacao || null

  const { error } = await supabaseAdmin
    .from('producao_pedido')
    .upsert(patch, { onConflict: 'pedido_id' })

  if (error) return { ok: false, erro: 'Não foi possível salvar' }

  // Evento só quando a etapa muda. Editar a observação não é movimento —
  // gravar isso encheria a linha do tempo de ruído.
  if (mudou) {
    await supabaseAdmin.from('producao_eventos').insert({
      pedido_id: params.pedidoId,
      de_etapa: de,
      para_etapa: params.etapa,
      autor: params.autor,
      autor_id: params.autorId ?? null,
      autor_nome: params.autorNome ?? null,
      observacao: params.observacao ?? null,
    })
  }

  return { ok: true, etapa: params.etapa }
}

/** Linha do tempo de um pedido, do mais recente para o mais antigo. */
export async function timelineProducao(pedidoId: string): Promise<EventoProducao[]> {
  const { data } = await supabaseAdmin
    .from('producao_eventos')
    .select('id, de_etapa, para_etapa, autor, autor_nome, observacao, criado_em')
    .eq('pedido_id', pedidoId)
    .order('criado_em', { ascending: false })

  return ((data ?? []) as unknown as {
    id: string
    de_etapa: string | null
    para_etapa: string
    autor: string
    autor_nome: string | null
    observacao: string | null
    criado_em: string
  }[]).map((e) => ({
    id: e.id,
    deEtapa: e.de_etapa,
    paraEtapa: e.para_etapa,
    autor: e.autor,
    autorNome: e.autor_nome,
    observacao: e.observacao,
    criadoEm: e.criado_em,
  }))
}
