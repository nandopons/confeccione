// app/lib/orfaos.ts
// ============================================================================
// Sistema de Pedidos Órfãos (Sprint 1).
//
// Pedido órfão = pedido que esgotou a fila de fornecedores compatíveis.
// Critério em detectarOrfaos(). Tabela de apoio: pedidos_orfaos.
//
// Funções públicas:
//   - detectarOrfaos()        → cron de hora em hora encontra novos órfãos
//   - matchingRetroativo()    → callback chamado quando fornecedor se cadastra
//   - calcularPrioridade()    → score 0-100 pro painel admin ordenar
//   - listarOrfaos()          → consumida pelo painel /admin/orfaos
//   - atualizarStatusOrfao()  → ações do admin (marcar em captação/resolvido/etc)
//
// Notificações ao cliente/admin: TODOs marcados, console.log por enquanto.
// Plugar real depois usando as funções existentes em app/lib/email.ts e
// app/lib/zapi.ts como referência.
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import { criarEDispararOferta } from './ofertas'
import { STATUS_FORNECEDOR_ATIVO, fornecedorAtendePedido } from './matching'

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================

/** Idade mínima do pedido pra ser considerado órfão (horas). */
const IDADE_MIN_ORFAO_HORAS = 4

/** Status de pedido considerados elegíveis pra detecção e classificação
 *  operacional. em_negociacao e estados fechados ficam fora — o fluxo está
 *  avançando. Compartilhado entre detectarOrfaos() e o dashboard /admin
 *  (queries de contagem) — fonte única de verdade. */
export const STATUS_PEDIDO_DETECTAVEL: readonly string[] = [
  'buscando_fornecedor',
]

/** Status de oferta que indicam captação ainda ativa. Se um pedido tem
 *  qualquer oferta nesses estados, NÃO é órfão (ainda). */
const STATUS_OFERTA_BLOQUEANTE: readonly string[] = ['enviada', 'aceita']

/** Status de órfão que representam "trabalho em andamento". Usado pra
 *  idempotência: pedido já com órfão nesses estados não é re-inserido. */
const STATUS_ORFAO_ATIVO: readonly string[] = ['aberto', 'em_captacao']

// ============================================================================
// TIPOS
// ============================================================================

export type StatusOrfao = 'aberto' | 'em_captacao' | 'resolvido' | 'descartado'

/** Transições permitidas entre status de órfão. Fonte única — usada pelo
 *  route handler antes do UPDATE pra detectar conflito (admin com 2 abas,
 *  uma já mudou status, outra clica botão em estado desatualizado). */
export const TRANSICOES_PERMITIDAS: Record<StatusOrfao, readonly StatusOrfao[]> = {
  aberto:      ['em_captacao', 'resolvido', 'descartado'],
  em_captacao: ['resolvido', 'descartado', 'aberto'],
  resolvido:   ['aberto', 'descartado'],
  descartado:  ['aberto'],
}

/** Função pura: 'de → para' é uma transição válida? */
export function podeTransicionarOrfao(de: StatusOrfao, para: StatusOrfao): boolean {
  return TRANSICOES_PERMITIDAS[de]?.includes(para) ?? false
}

/** Linha da view vw_pedidos_orfaos_admin (admin-only, contém contato cliente). */
export type VwPedidoOrfaoAdmin = {
  orfao_id: string
  status_orfao: StatusOrfao
  prioridade: number
  motivo_orfao: string | null
  tentativas_captacao: number
  responsavel_captacao: string | null
  notas_admin: string | null
  detectado_em: string
  orfao_atualizado_em: string
  pedido_id: string
  tipo: string
  quantidade: number | null
  prazo: string
  estado: string
  nome: string
  whatsapp: string
  email: string | null
  descricao: string | null
  pedido_status: string
  pedido_criado_em: string
  idade_horas: number
}

type PedidoCandidato = {
  id: string
  tipo: string
  quantidade: number | null
  estado: string
  criado_em: string
}

type OrfaoDetectado = {
  orfao_id: string
  pedido_id: string
  prioridade: number
  motivo: string
}

// ============================================================================
// PRIORIDADE
// ============================================================================

/** Calcula prioridade 0-100.
 *
 *  Regra atual: base 50 + (qtd>100: +30) + (idade>24h: +20).
 *
 *  Decisão de design: não diferenciamos por tipo de peça. A Confeccione
 *  cresce em todas as verticais, então marcar algumas como "populares"
 *  é arbitrário sem dado operacional que mostre assimetria real (ex:
 *  vertical X demora 3x mais pra fechar). Quando essa assimetria aparecer,
 *  adicionar regra explícita aqui. */
export function calcularPrioridade(pedido: PedidoCandidato): number {
  let pontos = 50

  const qtd = pedido.quantidade ?? 0
  if (qtd > 100) pontos += 30

  const idadeHoras =
    (Date.now() - new Date(pedido.criado_em).getTime()) / 1000 / 3600
  if (idadeHoras > 24) pontos += 20

  return Math.min(100, Math.max(0, pontos))
}

// ============================================================================
// DETECÇÃO
// ============================================================================

/** Detecta pedidos órfãos novos e os registra na tabela pedidos_orfaos.
 *
 *  Critério (ver migrations/2026-05-16-pedidos-orfaos.sql pro contexto):
 *    1. criado há mais de 4h
 *    2. status = buscando_fornecedor
 *    3. sem fornecedor aceito
 *    4. sem oferta em status 'enviada' ou 'aceita'
 *    5. ofertas terminais OU zero ofertas
 *    6. ainda não tem órfão ativo (aberto/em_captacao)
 *
 *  Idempotente: o índice UNIQUE parcial uq_pedidos_orfaos_pedido_ativo
 *  garante 1 órfão ativo por pedido no banco — esta função pré-filtra
 *  pra evitar erros de inserção. */
export async function detectarOrfaos(): Promise<OrfaoDetectado[]> {
  const agora = Date.now()
  const limiteIdade = new Date(
    agora - IDADE_MIN_ORFAO_HORAS * 3600 * 1000
  ).toISOString()
  const nowIso = new Date(agora).toISOString()

  // 1. Buscar candidatos: idade>4h + status detectável + sem fornecedor aceito.
  //    Respeita buscar_apos: pedidos criados fora do expediente têm
  //    buscar_apos no futuro até o scheduler disparar a 1ª oferta — não
  //    são órfãos antes disso (ver app/api/pedidos/criar/route.ts:76-87).
  const { data: candidatosRaw, error: candErr } = await supabaseAdmin
    .from('pedidos')
    .select('id, tipo, quantidade, estado, criado_em')
    .lt('criado_em', limiteIdade)
    .in('status', STATUS_PEDIDO_DETECTAVEL as string[])
    .is('fornecedor_aceito_id', null)
    .or(`buscar_apos.is.null,buscar_apos.lte.${nowIso}`)

  if (candErr) {
    throw new Error(`detectarOrfaos: erro ao buscar candidatos: ${candErr.message}`)
  }

  const candidatos = (candidatosRaw ?? []) as PedidoCandidato[]
  if (candidatos.length === 0) return []

  const ids = candidatos.map((p) => p.id)

  // 2. Filtrar quem já é órfão ativo (idempotência)
  const { data: orfaosAtivosRaw, error: orfErr } = await supabaseAdmin
    .from('pedidos_orfaos')
    .select('pedido_id')
    .in('pedido_id', ids)
    .in('status_orfao', STATUS_ORFAO_ATIVO as string[])

  if (orfErr) {
    throw new Error(
      `detectarOrfaos: erro ao buscar órfãos existentes: ${orfErr.message}`
    )
  }

  const jaOrfao = new Set(
    (orfaosAtivosRaw ?? []).map((o) => (o as { pedido_id: string }).pedido_id)
  )
  const restantes = candidatos.filter((p) => !jaOrfao.has(p.id))
  if (restantes.length === 0) return []

  // 3. Buscar ofertas dos pedidos restantes (classificar zero/terminais/ativas)
  const idsRestantes = restantes.map((p) => p.id)
  const { data: ofertasRaw, error: ofErr } = await supabaseAdmin
    .from('ofertas')
    .select('pedido_id, status')
    .in('pedido_id', idsRestantes)

  if (ofErr) {
    throw new Error(`detectarOrfaos: erro ao buscar ofertas: ${ofErr.message}`)
  }

  const ofertasPorPedido = new Map<string, string[]>()
  for (const o of ofertasRaw ?? []) {
    const row = o as { pedido_id: string; status: string }
    const arr = ofertasPorPedido.get(row.pedido_id) ?? []
    arr.push(row.status)
    ofertasPorPedido.set(row.pedido_id, arr)
  }

  // 4. Classificar e montar inserts
  const inserts: Array<{
    pedido_id: string
    prioridade: number
    motivo_orfao: string
  }> = []

  for (const p of restantes) {
    const statusOfertas = ofertasPorPedido.get(p.id) ?? []

    // Bloqueio: alguma oferta ainda ativa → captação viva, não é órfão
    const temAtiva = statusOfertas.some((s) =>
      STATUS_OFERTA_BLOQUEANTE.includes(s)
    )
    if (temAtiva) continue

    const prioridade = calcularPrioridade(p)
    const motivo =
      statusOfertas.length === 0
        ? '0 fornecedores compatíveis'
        : `${statusOfertas.length} ofertas recusadas/expiradas`

    inserts.push({
      pedido_id: p.id,
      prioridade,
      motivo_orfao: motivo,
    })
  }

  if (inserts.length === 0) return []

  // 5. Inserir órfãos
  const { data: inseridosRaw, error: insErr } = await supabaseAdmin
    .from('pedidos_orfaos')
    .insert(inserts)
    .select('id, pedido_id, prioridade, motivo_orfao')

  if (insErr) {
    throw new Error(`detectarOrfaos: erro ao inserir: ${insErr.message}`)
  }

  type InseridoRow = {
    id: string
    pedido_id: string
    prioridade: number
    motivo_orfao: string
  }
  const inseridos = (inseridosRaw ?? []) as InseridoRow[]

  // 6. Notificar (TODO console.log)
  const detectados: OrfaoDetectado[] = []
  for (const row of inseridos) {
    detectados.push({
      orfao_id: row.id,
      pedido_id: row.pedido_id,
      prioridade: row.prioridade,
      motivo: row.motivo_orfao,
    })

    const candidato = restantes.find((c) => c.id === row.pedido_id)
    if (candidato) {
      await notificarClienteOrfao(candidato)
      await notificarAdminOrfao(candidato, row.prioridade, row.motivo_orfao)
    }
  }

  return detectados
}

// ============================================================================
// MATCHING RETROATIVO
// ============================================================================

/** Quando um fornecedor novo se cadastra, varre órfãos abertos compatíveis
 *  com o perfil dele (tipo de produto, pedido_minimo, raio de atendimento)
 *  e dispara oferta pros pedidos cujo matching atual passaria a incluir ele.
 *
 *  Reusa criarEDispararOferta() de app/lib/ofertas.ts pra herdar o template
 *  de mensagem já auditado (nenhum contato do cliente vai pro fornecedor
 *  antes do aceite — princípio de monetização).
 *
 *  Só toca órfãos em 'aberto'. Órfãos em 'em_captacao' já têm trabalho em
 *  andamento — não disparamos oferta sobreposta.
 *
 *  Edge case raro aceito: se criarEDispararOferta não achar fornecedor
 *  compatível (ex: fornecedor novo já tem oferta 'enviada' em outro pedido
 *  e está excluído por essa razão), o sistema dispara o alerta padrão
 *  whatsappAdminSemFornecedor/emailAdminSemFornecedor pro admin — alerta
 *  espúrio pequeno. Custo de mitigar > custo do alerta raro. */
export async function matchingRetroativo(
  fornecedorId: string
): Promise<{ ofertasDisparadas: number; orfaosComOfertaAtiva: string[] }> {
  // 1. Carregar fornecedor com colunas necessárias pro filtro
  const { data: fornecedorRaw, error: fErr } = await supabaseAdmin
    .from('leads_fornecedores')
    .select('id, status, tipos_produto, pedido_minimo, raio_atendimento, estado')
    .eq('id', fornecedorId)
    .single()

  if (fErr || !fornecedorRaw) {
    throw new Error(
      `matchingRetroativo: fornecedor ${fornecedorId} não encontrado`
    )
  }

  const fornecedor = fornecedorRaw as {
    id: string
    status: string
    tipos_produto: string[]
    pedido_minimo: number
    raio_atendimento: string
    estado: string
  }

  if (fornecedor.status !== STATUS_FORNECEDOR_ATIVO) {
    return { ofertasDisparadas: 0, orfaosComOfertaAtiva: [] }
  }

  // 2. Listar órfãos abertos
  const { data: orfaosRaw, error: oErr } = await supabaseAdmin
    .from('pedidos_orfaos')
    .select('id, pedido_id')
    .eq('status_orfao', 'aberto')

  if (oErr) {
    throw new Error(`matchingRetroativo: erro ao listar órfãos: ${oErr.message}`)
  }

  const orfaos = (orfaosRaw ?? []) as Array<{ id: string; pedido_id: string }>
  if (orfaos.length === 0) {
    return { ofertasDisparadas: 0, orfaosComOfertaAtiva: [] }
  }

  // 3. Buscar pedidos correspondentes
  const pedidoIds = orfaos.map((o) => o.pedido_id)
  const { data: pedidosRaw, error: pErr } = await supabaseAdmin
    .from('pedidos')
    .select('id, tipo, quantidade, estado, status, fornecedor_aceito_id')
    .in('id', pedidoIds)

  if (pErr) {
    throw new Error(
      `matchingRetroativo: erro ao buscar pedidos: ${pErr.message}`
    )
  }

  type PedidoRow = {
    id: string
    tipo: string
    quantidade: number | null
    estado: string
    status: string
    fornecedor_aceito_id: string | null
  }
  const pedidosMap = new Map<string, PedidoRow>()
  for (const p of (pedidosRaw ?? []) as PedidoRow[]) {
    pedidosMap.set(p.id, p)
  }

  // 4. Filtrar órfãos cujos pedidos são compatíveis com o fornecedor.
  //    Estado do pedido (status + sem fornecedor aceito) é checado aqui;
  //    as regras de compatibilidade fornecedor↔pedido (tipo, pedido_minimo,
  //    raio) vêm da função pura fornecedorAtendePedido em app/lib/matching.ts
  //    — fonte única conceitual da regra.
  const compativeis: Array<{ orfaoId: string; pedidoId: string }> = []

  for (const o of orfaos) {
    const p = pedidosMap.get(o.pedido_id)
    if (!p) continue

    if (p.fornecedor_aceito_id !== null) continue
    if (!STATUS_PEDIDO_DETECTAVEL.includes(p.status)) continue

    if (!fornecedorAtendePedido(fornecedor, p)) continue

    compativeis.push({ orfaoId: o.id, pedidoId: o.pedido_id })
  }

  if (compativeis.length === 0) {
    return { ofertasDisparadas: 0, orfaosComOfertaAtiva: [] }
  }

  // 5. Pra cada compatível: dispara oferta (template auditado) e marca em_captacao
  const orfaosComOfertaAtiva: string[] = []
  let ofertasDisparadas = 0

  for (const c of compativeis) {
    try {
      await criarEDispararOferta(c.pedidoId)

      const { error: updErr } = await supabaseAdmin
        .from('pedidos_orfaos')
        .update({ status_orfao: 'em_captacao' })
        .eq('id', c.orfaoId)

      if (updErr) {
        console.error(
          `matchingRetroativo: falha ao atualizar órfão ${c.orfaoId}:`,
          updErr
        )
        continue
      }

      orfaosComOfertaAtiva.push(c.orfaoId)
      ofertasDisparadas++
    } catch (err) {
      console.error(
        `matchingRetroativo: falha ao disparar oferta pro pedido ${c.pedidoId}:`,
        err
      )
    }
  }

  return { ofertasDisparadas, orfaosComOfertaAtiva }
}

// ============================================================================
// LISTAGEM / ATUALIZAÇÃO (admin)
// ============================================================================

/** Lista órfãos pra painel admin. Ordena por prioridade DESC + detecção DESC. */
export async function listarOrfaos(
  filtro: { status?: StatusOrfao | 'todos' } = {}
): Promise<VwPedidoOrfaoAdmin[]> {
  let q = supabaseAdmin
    .from('vw_pedidos_orfaos_admin')
    .select('*')
    .order('prioridade', { ascending: false })
    .order('detectado_em', { ascending: false })

  if (filtro.status && filtro.status !== 'todos') {
    q = q.eq('status_orfao', filtro.status)
  }

  const { data, error } = await q

  if (error) {
    throw new Error(`listarOrfaos: ${error.message}`)
  }

  return (data ?? []) as VwPedidoOrfaoAdmin[]
}

/** Atualiza status (e opcionalmente notas/responsável) de um órfão.
 *  Trigger no banco atualiza atualizado_em automaticamente. */
export async function atualizarStatusOrfao(
  id: string,
  novoStatus: StatusOrfao,
  metadados?: { notas_admin?: string; responsavel_captacao?: string }
): Promise<void> {
  const update: {
    status_orfao: StatusOrfao
    notas_admin?: string
    responsavel_captacao?: string
  } = { status_orfao: novoStatus }

  if (metadados?.notas_admin !== undefined) {
    update.notas_admin = metadados.notas_admin
  }
  if (metadados?.responsavel_captacao !== undefined) {
    update.responsavel_captacao = metadados.responsavel_captacao
  }

  const { error } = await supabaseAdmin
    .from('pedidos_orfaos')
    .update(update)
    .eq('id', id)

  if (error) {
    throw new Error(`atualizarStatusOrfao: ${error.message}`)
  }
}

// ============================================================================
// NOTIFICAÇÕES (TODO — console.log por enquanto)
// ============================================================================

/** TODO: notificar cliente de que pedido virou órfão.
 *
 *  Quando plugar a real: usar email (Resend) e/ou WhatsApp (Z-API) seguindo
 *  o padrão de app/lib/email.ts (ex: emailBoasVindasFornecedor). Mensagem
 *  precisa ser cuidadosa — "não achamos fornecedor pro seu pedido" pode
 *  ser ruim de receber. Considere: "estamos ampliando a busca por você"
 *  ou similar. Validar com o Fernando antes de ligar. */
async function notificarClienteOrfao(pedido: PedidoCandidato): Promise<void> {
  console.log('[orfaos][TODO notificarClienteOrfao]', {
    pedido_id: pedido.id,
    tipo: pedido.tipo,
    estado: pedido.estado,
    quantidade: pedido.quantidade,
    criado_em: pedido.criado_em,
  })
}

/** TODO: notificar admin (Fernando) de que pedido virou órfão.
 *
 *  Quando plugar a real: usar whatsappAdminSemFornecedor (app/lib/zapi.ts)
 *  e emailAdminSemFornecedor (app/lib/email.ts) como referência. Admin
 *  pode receber contato do cliente — é mensagem interna, não vai pro
 *  fornecedor. */
async function notificarAdminOrfao(
  pedido: PedidoCandidato,
  prioridade: number,
  motivo: string
): Promise<void> {
  console.log('[orfaos][TODO notificarAdminOrfao]', {
    pedido_id: pedido.id,
    tipo: pedido.tipo,
    estado: pedido.estado,
    quantidade: pedido.quantidade,
    criado_em: pedido.criado_em,
    prioridade,
    motivo,
  })
}
