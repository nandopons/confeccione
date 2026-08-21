// app/lib/producao.ts
// ============================================================================
// CRM de produção — o pedaço que faltava entre "cliente pagou" e "finalizado".
//
// DUAS ORIGENS DE CARD
//   'assistente' -> pedidos_assistente (marketplace: cliente pediu, fornecedor
//                   aceitou e orçou, cliente pagou pelo Asaas)
//   'orcamento'  -> orcamentos (orçamento avulso feito por você no admin, com
//                   cobrança Asaas gerada na hora)
// Os dois viram produção. Não fabrico um pedidos_assistente falso a partir do
// orçamento avulso porque isso poluiria funil, métricas e painel do fornecedor
// com pedidos que nunca passaram por oferta.
//
// SÓ ENTRA O QUE FOI PAGO
// Antes do pagamento o pedido ainda é comercial. O próprio sistema diz ao
// fornecedor para não começar antes de pagar — um card de algo que não pode
// ser produzido só polui o quadro.
//
// QUEM MOVE
// Admin move tudo. Fornecedor move só os pedidos que ele assumiu (origem
// 'assistente'); orçamento avulso não tem fornecedor, é seu.
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import { resumirLinhas, type LinhaPedido } from './pedido-assistente-oferta'
import { ehEtapa, type Etapa } from './producao-etapas'
import { AVISOS } from './producao-avisos'
import { emailProducaoAtualizada } from './email'
import { avisoOficial } from './whatsapp-notify'

// As etapas moram em producao-etapas.ts, sem import de servidor, porque o
// componente cliente do painel do fornecedor precisa da lista — e importar
// deste arquivo arrastaria o supabaseAdmin (service role) pro bundle.
export { ETAPAS, ehEtapa, tituloEtapa, type Etapa } from './producao-etapas'

export type OrigemCard = 'assistente' | 'orcamento'

export type CardProducao = {
  cardId: string
  origem: OrigemCard
  pedidoId: string | null
  orcamentoId: string | null
  etapa: Etapa
  entrouEtapaEm: string
  observacao: string | null
  // Identificação
  referencia: string        // ORC-2026-0007 ou os 8 primeiros do uuid
  clienteNome: string | null
  totalPecas: number
  resumo: string
  valorCentavos: number | null
  repasseCentavos: number | null
  criadoEm: string
  // Só em origem 'assistente'
  fornecedorId: string | null
  fornecedorNome: string | null
  // Arquivamento
  arquivadoEm: string | null
  arquivadoMotivo: string | null
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

function dias(desde: string): number {
  const ms = Date.now() - new Date(desde).getTime()
  return Math.max(0, Math.floor(ms / 86_400_000))
}

const SITE = 'https://www.confeccione.com.br'

function refCurta(uuid: string): string {
  return uuid.replace(/-/g, '').slice(0, 8).toUpperCase()
}

type LinhaProducao = {
  id: string
  pedido_id: string | null
  orcamento_id: string | null
  etapa: Etapa
  entrou_etapa_em: string
  observacao: string | null
  arquivado_em: string | null
  arquivado_motivo: string | null
}

const COLUNAS_CARD =
  'id, pedido_id, orcamento_id, etapa, entrou_etapa_em, observacao, arquivado_em, arquivado_motivo'

/**
 * Garante a linha de produção das origens passadas e devolve todas.
 *
 * Criação sob demanda em vez de gatilho no pagamento: é o que faz os pedidos
 * que JÁ estavam pagos antes desta funcionalidade existir aparecerem sem
 * migração de dados, e cobre também qualquer pagamento que o webhook tenha
 * perdido e a reconciliação tenha resgatado depois.
 *
 * Devolve TAMBÉM os arquivados, de propósito: é a linha arquivada que faz o
 * `faltando` abaixo não recriar o card. Quem filtra é `carregarQuadro`.
 */
async function garantirCards(
  pedidoIds: string[],
  orcamentoIds: string[],
): Promise<Map<string, LinhaProducao>> {
  const mapa = new Map<string, LinhaProducao>()
  if (!pedidoIds.length && !orcamentoIds.length) return mapa

  const consultas: Promise<{ data: unknown }>[] = []
  if (pedidoIds.length) {
    consultas.push(
      supabaseAdmin
        .from('producao_pedido')
        .select(COLUNAS_CARD)
        .in('pedido_id', pedidoIds) as unknown as Promise<{ data: unknown }>,
    )
  }
  if (orcamentoIds.length) {
    consultas.push(
      supabaseAdmin
        .from('producao_pedido')
        .select(COLUNAS_CARD)
        .in('orcamento_id', orcamentoIds) as unknown as Promise<{ data: unknown }>,
    )
  }

  for (const r of await Promise.all(consultas)) {
    for (const linha of (r.data ?? []) as LinhaProducao[]) {
      mapa.set(linha.pedido_id ?? linha.orcamento_id!, linha)
    }
  }

  const faltando = [
    ...pedidoIds.filter((id) => !mapa.has(id)).map((id) => ({ pedido_id: id, orcamento_id: null })),
    ...orcamentoIds.filter((id) => !mapa.has(id)).map((id) => ({ pedido_id: null, orcamento_id: id })),
  ]

  if (faltando.length) {
    const agora = new Date().toISOString()
    const { data: criados } = await supabaseAdmin
      .from('producao_pedido')
      .insert(faltando.map((f) => ({ ...f, etapa: 'planejamento', entrou_etapa_em: agora })))
      .select(COLUNAS_CARD)

    await supabaseAdmin.from('producao_eventos').insert(
      faltando.map((f) => ({
        ...f,
        de_etapa: null,
        para_etapa: 'planejamento',
        autor: 'sistema',
        observacao: 'Pagamento confirmado — entrou na fila de produção',
      })),
    )

    for (const linha of ((criados ?? []) as unknown as LinhaProducao[])) {
      mapa.set(linha.pedido_id ?? linha.orcamento_id!, linha)
    }
  }

  return mapa
}

/**
 * Monta o quadro.
 *
 * `fornecedorId` restringe ao que aquele fornecedor assumiu — e, nesse caso,
 * orçamento avulso não entra: não tem fornecedor, é trabalho seu.
 *
 * `verArquivados` inverte o filtro e devolve SÓ os arquivados — é a lista da
 * gaveta, pra você conferir o que tirou e desarquivar se errou. Fornecedor
 * nunca vê arquivado: card fora do quadro não é trabalho dele.
 */
export async function carregarQuadro(
  fornecedorId?: string,
  verArquivados = false,
): Promise<CardProducao[]> {
  type PedidoRow = {
    id: string
    nome: string | null
    linhas: LinhaPedido[] | null
    valor_centavos: number | null
    repasse_centavos: number | null
    criado_em: string
  }
  type OrcamentoRow = {
    id: string
    numero: string
    cliente_nome: string | null
    itens: { descricao?: string; quantidade?: number }[] | null
    total_centavos: number | null
    criado_em: string
  }

  const [pedidosRes, orcamentosRes] = await Promise.all([
    supabaseAdmin
      .from('pedidos_assistente')
      .select('id, nome, linhas, valor_centavos, repasse_centavos, criado_em')
      .eq('pagamento_status', 'pago')
      .is('finalizado_em', null)
      .order('criado_em', { ascending: true }),
    // Orçamento avulso não tem "finalizado" — sai do quadro quando você o
    // arrasta pra Pronto e, daí em diante, ele simplesmente fica lá.
    fornecedorId
      ? Promise.resolve({ data: [] })
      : supabaseAdmin
          .from('orcamentos')
          .select('id, numero, cliente_nome, itens, total_centavos, criado_em')
          .eq('pagamento_status', 'pago')
          .order('criado_em', { ascending: true }),
  ])

  const pedidos = ((pedidosRes.data ?? []) as unknown as PedidoRow[])
  const orcamentos = ((orcamentosRes.data ?? []) as unknown as OrcamentoRow[])

  // Fornecedor que assumiu cada pedido
  const porPedidoFornecedor = new Map<string, { id: string; nome: string | null }>()
  if (pedidos.length) {
    const { data: ofertas } = await supabaseAdmin
      .from('ofertas_pedido_assistente')
      .select('pedido_id, fornecedor_id, leads_fornecedores(nome)')
      .in('pedido_id', pedidos.map((p) => p.id))
      .eq('status', 'aceita')

    for (const o of (ofertas ?? []) as unknown as {
      pedido_id: string
      fornecedor_id: string
      leads_fornecedores: { nome: string | null } | null
    }[]) {
      porPedidoFornecedor.set(o.pedido_id, { id: o.fornecedor_id, nome: o.leads_fornecedores?.nome ?? null })
    }
  }

  const pedidosVisiveis = fornecedorId
    ? pedidos.filter((p) => porPedidoFornecedor.get(p.id)?.id === fornecedorId)
    : pedidos

  const cards = await garantirCards(
    pedidosVisiveis.map((p) => p.id),
    orcamentos.map((o) => o.id),
  )

  // Fornecedor nunca enxerga a gaveta — card arquivado saiu do quadro, e pra
  // ele isso é simplesmente trabalho que não existe mais.
  const querArquivado = verArquivados && !fornecedorId
  const naGaveta = (id: string) => Boolean(cards.get(id)?.arquivado_em) === querArquivado

  const doPedido: CardProducao[] = pedidosVisiveis.filter((p) => naGaveta(p.id)).map((p) => {
    const c = cards.get(p.id)!
    const { totalPecas, texto } = resumirLinhas(Array.isArray(p.linhas) ? p.linhas : [])
    const forn = porPedidoFornecedor.get(p.id) ?? null
    return {
      cardId: c.id,
      origem: 'assistente' as const,
      pedidoId: p.id,
      orcamentoId: null,
      etapa: c.etapa,
      entrouEtapaEm: c.entrou_etapa_em,
      observacao: c.observacao,
      referencia: refCurta(p.id),
      clienteNome: p.nome,
      totalPecas,
      resumo: texto,
      valorCentavos: p.valor_centavos,
      repasseCentavos: p.repasse_centavos,
      criadoEm: p.criado_em,
      fornecedorId: forn?.id ?? null,
      fornecedorNome: forn?.nome ?? null,
      arquivadoEm: c.arquivado_em,
      arquivadoMotivo: c.arquivado_motivo,
      diasNaEtapa: dias(c.entrou_etapa_em),
    }
  })

  const doOrcamento: CardProducao[] = orcamentos.filter((o) => naGaveta(o.id)).map((o) => {
    const c = cards.get(o.id)!
    const itens = Array.isArray(o.itens) ? o.itens : []
    const totalPecas = itens.reduce((s, i) => s + (Number(i?.quantidade) || 0), 0)
    const resumo = itens.length
      ? itens.map((i) => `${Number(i?.quantidade) || 0}× ${i?.descricao ?? 'item'}`).join('\n')
      : 'Sem itens detalhados'
    return {
      cardId: c.id,
      origem: 'orcamento' as const,
      pedidoId: null,
      orcamentoId: o.id,
      etapa: c.etapa,
      entrouEtapaEm: c.entrou_etapa_em,
      observacao: c.observacao,
      referencia: o.numero,
      clienteNome: o.cliente_nome,
      totalPecas,
      resumo,
      valorCentavos: o.total_centavos,
      // Orçamento avulso é seu: não há repasse a terceiro.
      repasseCentavos: null,
      criadoEm: o.criado_em,
      fornecedorId: null,
      fornecedorNome: null,
      arquivadoEm: c.arquivado_em,
      arquivadoMotivo: c.arquivado_motivo,
      diasNaEtapa: dias(c.entrou_etapa_em),
    }
  })

  return [...doPedido, ...doOrcamento]
}

// ---------------------------------------------------------------------------
// Aviso ao cliente quando o pedido muda de etapa
//
// TRES TRAVAS, TODAS DE PROPOSITO:
//
// 1. So avisa a PRIMEIRA vez que o pedido chega numa etapa. Producao volta —
//    peca sai da costura e retorna pra estamparia porque a estampa falhou — e
//    o cliente nao pode receber "sua estampa esta sendo aplicada" tres vezes.
//    A checagem e no historico: se ja existe evento com aquele para_etapa,
//    cala a boca.
//
// 2. NAO avisa na entrada automatica no quadro. `garantirCards` cria o card
//    quando o pagamento e confirmado, e isso vale pra pedidos que ja estavam
//    pagos antes desta funcionalidade existir — avisar dali dispararia uma
//    leva de e-mails sobre pedidos velhos.
//
// 3. WhatsApp so em 'pronto'. E-mail em toda etapa foi decisao do Fernando
//    (21/08/2026); WhatsApp em toda etapa seria interromper a pessoa oito
//    vezes por uma camiseta.
//
// Failure-soft inteiro: aviso que falha nao pode impedir o card de andar.
// ---------------------------------------------------------------------------
async function avisarCliente(params: {
  pedidoId: string | null
  orcamentoId: string | null
  etapa: Etapa
}): Promise<void> {
  try {
    const aviso = AVISOS[params.etapa]
    if (!aviso) return

    let email: string | null = null
    let telefone: string | null = null
    let nome: string | null = null
    let referencia = ''
    let link: string | null = null

    if (params.pedidoId) {
      const { data } = await supabaseAdmin
        .from('pedidos_assistente')
        .select('nome, email, telefone')
        .eq('id', params.pedidoId)
        .maybeSingle<{ nome: string | null; email: string | null; telefone: string | null }>()
      if (!data) return
      nome = data.nome
      email = data.email
      telefone = data.telefone
      referencia = refCurta(params.pedidoId)
      link = `${SITE}/visualizador/${params.pedidoId}`
    } else if (params.orcamentoId) {
      const { data } = await supabaseAdmin
        .from('orcamentos')
        .select('cliente_nome, cliente_email, numero')
        .eq('id', params.orcamentoId)
        .maybeSingle<{ cliente_nome: string | null; cliente_email: string | null; numero: string }>()
      if (!data) return
      nome = data.cliente_nome
      email = data.cliente_email
      // A tabela `orcamentos` nao guarda telefone — so nome, documento e email.
      // Entao orcamento avulso avisa por e-mail e nao por WhatsApp. Se quiser
      // WhatsApp aqui, precisa de uma coluna de telefone no formulario.
      telefone = null
      referencia = data.numero
      link = null
    } else {
      return
    }

    if (email) {
      await emailProducaoAtualizada({
        email,
        nome,
        titulo: aviso.titulo,
        corpo: aviso.corpo,
        referencia,
        link,
      })
    }

    if (aviso.whatsapp && telefone && params.pedidoId) {
      await avisoOficial({
        telefone,
        nome,
        texto: `${aviso.titulo}\n\n${aviso.corpo}\n\nPedido ${referencia}`,
        resumo: aviso.resumo,
        caminhoBotao: `visualizador/${params.pedidoId}`,
      })
    }
  } catch (e) {
    console.error('[producao] aviso ao cliente falhou', e)
  }
}

/** Ja avisamos esta etapa antes? Historico e a fonte da verdade. */
async function jaPassouPor(
  pedidoId: string | null,
  orcamentoId: string | null,
  etapa: Etapa,
): Promise<boolean> {
  const q = supabaseAdmin.from('producao_eventos').select('id').eq('para_etapa', etapa).limit(1)
  const { data } = pedidoId
    ? await q.eq('pedido_id', pedidoId)
    : await q.eq('orcamento_id', orcamentoId!)
  return (data ?? []).length > 0
}

export type ResultadoMover = { ok: true; etapa: Etapa } | { ok: false; erro: string }

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
  cardId: string
  etapa: Etapa
  autor: 'admin' | 'fornecedor'
  autorId?: string | null
  autorNome?: string | null
  observacao?: string | null
  // Quando presente, exige que o card seja de um pedido deste fornecedor.
  exigirFornecedorId?: string
}): Promise<ResultadoMover> {
  if (!ehEtapa(params.etapa)) return { ok: false, erro: 'Etapa desconhecida' }

  const { data: card } = await supabaseAdmin
    .from('producao_pedido')
    .select('id, pedido_id, orcamento_id, etapa, arquivado_em')
    .eq('id', params.cardId)
    .maybeSingle<{
      id: string
      pedido_id: string | null
      orcamento_id: string | null
      etapa: Etapa
      arquivado_em: string | null
    }>()

  if (!card) return { ok: false, erro: 'Card não encontrado' }

  // Card arquivado não anda. Sem esta trava, uma aba velha aberta no quadro
  // (ou o painel do fornecedor) moveria um card que você tirou fora — e o
  // movimento dispararia aviso ao cliente de um pedido encerrado.
  if (card.arquivado_em) {
    return { ok: false, erro: 'Card arquivado — desarquive antes de mover' }
  }

  if (params.exigirFornecedorId) {
    // Fornecedor não mexe em orçamento avulso — aquilo não passou por oferta.
    if (!card.pedido_id) return { ok: false, erro: 'Este pedido não é seu' }
    const { data: oferta } = await supabaseAdmin
      .from('ofertas_pedido_assistente')
      .select('id')
      .eq('pedido_id', card.pedido_id)
      .eq('fornecedor_id', params.exigirFornecedorId)
      .eq('status', 'aceita')
      .maybeSingle()
    if (!oferta) return { ok: false, erro: 'Este pedido não é seu' }
  }

  const mudou = card.etapa !== params.etapa
  const agora = new Date().toISOString()

  const patch: Record<string, unknown> = { etapa: params.etapa, atualizado_em: agora }
  if (mudou) patch.entrou_etapa_em = agora
  if (params.observacao !== undefined) patch.observacao = params.observacao || null

  const { error } = await supabaseAdmin.from('producao_pedido').update(patch).eq('id', card.id)
  if (error) return { ok: false, erro: 'Não foi possível salvar' }

  // Evento só quando a etapa muda. Editar a observação não é movimento —
  // gravar isso encheria a linha do tempo de ruído.
  if (mudou) {
    // Consulta ANTES de inserir o evento novo: depois do insert a resposta
    // seria sempre "sim, ja passou".
    const repetida = await jaPassouPor(card.pedido_id, card.orcamento_id, params.etapa)

    await supabaseAdmin.from('producao_eventos').insert({
      pedido_id: card.pedido_id,
      orcamento_id: card.orcamento_id,
      de_etapa: card.etapa,
      para_etapa: params.etapa,
      autor: params.autor,
      autor_id: params.autorId ?? null,
      autor_nome: params.autorNome ?? null,
      observacao: params.observacao ?? null,
    })

    if (!repetida) {
      await avisarCliente({
        pedidoId: card.pedido_id,
        orcamentoId: card.orcamento_id,
        etapa: params.etapa,
      })
    }
  }

  return { ok: true, etapa: params.etapa }
}

/**
 * Tira o card do quadro sem fazê-lo percorrer as oito etapas — ou o traz de
 * volta (`arquivar: false`).
 *
 * POR QUE ARQUIVAR E NÃO APAGAR
 * Apagar a linha não resolveria nada: `garantirCards` recria o card de qualquer
 * pedido pago que não tenha linha, então o card voltaria na próxima carga do
 * quadro. A linha arquivada é justamente a lápide que impede isso. De quebra,
 * o histórico em `producao_eventos` continua de pé — o pedido existiu, foi
 * produzido, e daqui a seis meses alguém vai querer saber quando.
 *
 * NÃO DISPARA AVISO AO CLIENTE, nem grava evento de etapa: arquivar não é
 * movimento de fábrica. Mandar "seu pedido está pronto" pra alguém que recebeu
 * em junho seria pior do que o quadro sujo.
 */
export async function arquivarCard(params: {
  cardId: string
  arquivar: boolean
  motivo?: string | null
}): Promise<ResultadoMover> {
  const { data: card } = await supabaseAdmin
    .from('producao_pedido')
    .select('id, etapa')
    .eq('id', params.cardId)
    .maybeSingle<{ id: string; etapa: Etapa }>()

  if (!card) return { ok: false, erro: 'Card não encontrado' }

  const agora = new Date().toISOString()
  const { error } = await supabaseAdmin
    .from('producao_pedido')
    .update({
      arquivado_em: params.arquivar ? agora : null,
      arquivado_motivo: params.arquivar ? (params.motivo?.trim() || null) : null,
      atualizado_em: agora,
      // Desarquivar zera o contador: o card volta "de hoje", senão reapareceria
      // já vermelho de 90 dias e roubaria a atenção de quem está atrasado
      // de verdade.
      ...(params.arquivar ? {} : { entrou_etapa_em: agora }),
    })
    .eq('id', card.id)

  if (error) return { ok: false, erro: 'Não foi possível salvar' }
  return { ok: true, etapa: card.etapa }
}

/** Linha do tempo de um card, do mais recente para o mais antigo. */
export async function timelineProducao(cardId: string): Promise<EventoProducao[]> {
  const { data: card } = await supabaseAdmin
    .from('producao_pedido')
    .select('pedido_id, orcamento_id')
    .eq('id', cardId)
    .maybeSingle<{ pedido_id: string | null; orcamento_id: string | null }>()

  if (!card) return []

  const consulta = supabaseAdmin
    .from('producao_eventos')
    .select('id, de_etapa, para_etapa, autor, autor_nome, observacao, criado_em')
    .order('criado_em', { ascending: false })

  const { data } = card.pedido_id
    ? await consulta.eq('pedido_id', card.pedido_id)
    : await consulta.eq('orcamento_id', card.orcamento_id!)

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

/**
 * Card do fornecedor a partir do pedido — o painel dele não conhece cardId.
 * Cria a linha se ainda não existir, pelo mesmo caminho do quadro.
 */
export async function cardIdDoPedido(pedidoId: string): Promise<string | null> {
  const cards = await garantirCards([pedidoId], [])
  return cards.get(pedidoId)?.id ?? null
}
