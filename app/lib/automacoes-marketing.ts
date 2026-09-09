// app/lib/automacoes-marketing.ts
// ============================================================================
// MOTOR DE AUTOMAÇÃO — os fluxos de nutrição.
//
// Um fluxo tem:
//   GATILHO  o que faz o lead entrar (lead novo, pedido parado, pós-compra,
//            lead frio) + o "há quantos dias"
//   PÚBLICO  um filtro da base por cima do gatilho (UF, tag, origem…)
//   PASSOS   sequência ordenada; cada passo tem uma espera em dias e um
//            template. Passo 1 espera a partir da entrada; os demais, a
//            partir do passo anterior.
//
// Cada lead que entra ganha uma linha em automacao_execucoes, com
// `proximo_em` marcando quando o próximo passo vence. Uma rodada
// (`rodarAutomacao`) faz duas coisas: inscreve quem passou a ser elegível e
// executa os passos vencidos.
//
// TRAVAS ANTI-SPAM (valem sempre, inclusive no "rodar agora"):
//   • opt-out sai do fluxo na hora
//   • um lead nunca entra duas vezes no mesmo fluxo (unique automacao+lead)
//   • teto de `max_toques` por lead POR FLUXO
//   • janela de horário (padrão 9h–20h de Recife) — ninguém acorda com oferta
//   • cap de MAX_POR_RODADA envios por execução
//   • o gatilho é reavaliado na hora do envio: quem comprou sai do fluxo de
//     retomada em vez de receber cobrança de um pedido que já pagou
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import {
  enviarConteudo,
  leadAlcancavel,
  type CanalEnvio,
} from './envio-marketing'
import { conteudoDoTemplate, obterTemplate, type TemplateMarketing } from './templates-marketing'
import { listarLeadsCompleto, registrarToque, type FiltroLeads, type Lead } from './leads-marketing'

export type Gatilho =
  | 'lead_novo'
  | 'pedido_parado'
  | 'pos_compra'
  | 'lead_frio'
  | 'etapa_captado'
  | 'etapa_pedido_completo'
  | 'etapa_sem_fornecedor'
  | 'etapa_sem_resposta'
  | 'etapa_orcamento_vencido'
  | 'etapa_inativo'
  | 'etapa_em_negociacao'

/** Gatilhos por etapa → a etapa da view que o pedido precisa estar. */
export const ETAPA_DO_GATILHO: Partial<Record<Gatilho, string>> = {
  etapa_captado: 'captado',
  etapa_pedido_completo: 'pedido_completo',
  etapa_sem_fornecedor: 'sem_fornecedor',
  etapa_sem_resposta: 'sem_resposta',
  etapa_orcamento_vencido: 'orcamento_vencido',
  etapa_inativo: 'inativo',
  etapa_em_negociacao: 'em_negociacao',
}
export type StatusAutomacao = 'rascunho' | 'ativa' | 'pausada'

export const MAX_POR_RODADA = 30

export const GATILHO_LABEL: Record<Gatilho, string> = {
  lead_novo: 'Lead novo entrou na base',
  pedido_parado: 'Pedido parado sem pagar',
  pos_compra: 'Depois da compra',
  lead_frio: 'Está na base e nunca comprou',
  etapa_captado: 'Pedido captado (peça incompleta)',
  etapa_pedido_completo: 'Pedido completo sem confirmar',
  etapa_sem_fornecedor: 'Pedido sem fornecedor',
  etapa_sem_resposta: 'Orçamento sem resposta do cliente',
  etapa_orcamento_vencido: 'Orçamento vencido (21 dias)',
  etapa_inativo: 'Pedido inativo (30 dias sem toque)',
  etapa_em_negociacao: 'Em negociação com o fornecedor',
}

/** Como o número de dias do gatilho deve ser lido na tela. */
export const GATILHO_AJUDA: Record<Gatilho, string> = {
  lead_novo: 'Só entram leads cadastrados nos últimos X dias — assim ligar o fluxo não dispara pra base inteira de uma vez.',
  pedido_parado: 'Entra quem montou pedido, não pagou e está parado há X dias.',
  pos_compra: 'Entra quem pagou há X dias.',
  lead_frio: 'Entra quem está na base há X dias, nunca comprou e não recebeu contato nesse período.',
  etapa_captado: 'Entra quem deixou contato mas a peça está incompleta (modelo, cor, quantidade) há X dias. Sai quando completa.',
  etapa_pedido_completo: 'Entra quem tem a peça completa e não clicou em "Buscar fornecedor" há X dias. Sai quando confirma.',
  etapa_sem_fornecedor: 'Entra o pedido confirmado há X dias sem fornecedor aceito. Sai quando alguém aceita.',
  etapa_sem_resposta: 'Entra quem recebeu orçamento e está há X dias sem responder. Sai quando responde, paga ou vence.',
  etapa_orcamento_vencido: 'Entra quem tem orçamento há mais de 21 dias sem pagar, há X dias nessa situação. Sai quando paga ou é encerrado.',
  etapa_inativo: 'Entra quem está captado ou completo há 30 dias sem nenhum toque, há X dias nessa situação. Sai quando mexe no pedido.',
  etapa_em_negociacao: 'Entra quem tem fornecedor aceito há X dias sem orçamento (D-9: aos 3 dias, perguntar se a conversa deu certo). Sai quando o orçamento é definido.',
}

export type PassoAutomacao = {
  id: string
  ordem: number
  esperaDias: number
  templateId: string | null
  ativo: boolean
}

export type Automacao = {
  id: string
  nome: string
  descricao: string | null
  gatilho: Gatilho
  gatilhoDias: number
  /** Minutos na etapa; quando definido, manda no lugar de gatilhoDias. */
  gatilhoMinutos: number | null
  publico: FiltroLeads
  maxToques: number
  horaInicio: number
  horaFim: number
  status: StatusAutomacao
  ultimaRodadaEm: string | null
  criadoEm: string
  passos: PassoAutomacao[]
}

type AutomacaoRow = {
  id: string
  nome: string
  descricao: string | null
  gatilho: Gatilho
  gatilho_dias: number
  publico: unknown
  max_toques: number
  hora_inicio: number
  hora_fim: number
  status: StatusAutomacao
  ultima_rodada_em: string | null
  criado_em: string
}

type PassoRow = {
  id: string
  automacao_id: string
  ordem: number
  espera_dias: number
  template_id: string | null
  ativo: boolean
}

const COLS_AUTO =
  'id, nome, descricao, gatilho, gatilho_dias, publico, max_toques, hora_inicio, hora_fim, status, ultima_rodada_em, criado_em'

function daLinha(r: AutomacaoRow, passos: PassoRow[]): Automacao {
  return {
    id: r.id,
    nome: r.nome,
    descricao: r.descricao,
    gatilho: r.gatilho,
    gatilhoDias: r.gatilho_dias,
    gatilhoMinutos: (r as { gatilho_minutos?: number | null }).gatilho_minutos ?? null,
    publico: (r.publico ?? {}) as FiltroLeads,
    maxToques: r.max_toques,
    horaInicio: r.hora_inicio,
    horaFim: r.hora_fim,
    status: r.status,
    ultimaRodadaEm: r.ultima_rodada_em,
    criadoEm: r.criado_em,
    passos: passos
      .filter((p) => p.automacao_id === r.id)
      .sort((a, b) => a.ordem - b.ordem)
      .map((p) => ({ id: p.id, ordem: p.ordem, esperaDias: p.espera_dias, templateId: p.template_id, ativo: p.ativo })),
  }
}

// ─────────────────────────────────────────────────────────────
// Leitura
// ─────────────────────────────────────────────────────────────

export async function listarAutomacoes(): Promise<Automacao[]> {
  const { data: autos } = await supabaseAdmin
    .from('automacoes_marketing')
    .select(COLS_AUTO)
    .order('criado_em', { ascending: false })
  const linhas = (autos ?? []) as AutomacaoRow[]
  if (linhas.length === 0) return []

  const { data: passos } = await supabaseAdmin
    .from('automacao_passos')
    .select('id, automacao_id, ordem, espera_dias, template_id, ativo')
    .in('automacao_id', linhas.map((a) => a.id))
  return linhas.map((a) => daLinha(a, (passos ?? []) as PassoRow[]))
}

export async function obterAutomacao(id: string): Promise<Automacao | null> {
  const { data } = await supabaseAdmin.from('automacoes_marketing').select(COLS_AUTO).eq('id', id).maybeSingle<AutomacaoRow>()
  if (!data) return null
  const { data: passos } = await supabaseAdmin
    .from('automacao_passos')
    .select('id, automacao_id, ordem, espera_dias, template_id, ativo')
    .eq('automacao_id', id)
  return daLinha(data, (passos ?? []) as PassoRow[])
}

export type EstatisticaFluxo = { ativos: number; concluidos: number; sairam: number; enviados: number }

export async function estatisticasAutomacoes(): Promise<Record<string, EstatisticaFluxo>> {
  const { data } = await supabaseAdmin
    .from('automacao_execucoes')
    .select('automacao_id, status, enviados')
    .limit(5000)
  const out: Record<string, EstatisticaFluxo> = {}
  for (const e of (data ?? []) as Array<{ automacao_id: string; status: string; enviados: number }>) {
    const s = (out[e.automacao_id] ??= { ativos: 0, concluidos: 0, sairam: 0, enviados: 0 })
    if (e.status === 'ativa') s.ativos++
    else if (e.status === 'concluida') s.concluidos++
    else s.sairam++
    s.enviados += e.enviados
  }
  return out
}

// ─────────────────────────────────────────────────────────────
// Escrita
// ─────────────────────────────────────────────────────────────

export type DadosAutomacao = {
  nome: string
  descricao?: string | null
  gatilho: Gatilho
  gatilhoDias: number
  publico: FiltroLeads
  maxToques: number
  horaInicio?: number
  horaFim?: number
  status?: StatusAutomacao
  passos: Array<{ esperaDias: number; templateId: string | null; ativo?: boolean }>
}

export async function salvarAutomacao(id: string | null, d: DadosAutomacao): Promise<string> {
  const campos = {
    nome: d.nome,
    descricao: d.descricao ?? null,
    gatilho: d.gatilho,
    gatilho_dias: d.gatilhoDias,
    publico: d.publico,
    max_toques: d.maxToques,
    hora_inicio: d.horaInicio ?? 9,
    hora_fim: d.horaFim ?? 20,
    ...(d.status ? { status: d.status } : {}),
    atualizado_em: new Date().toISOString(),
  }

  let automacaoId = id
  if (automacaoId) {
    const { error } = await supabaseAdmin.from('automacoes_marketing').update(campos).eq('id', automacaoId)
    if (error) throw new Error(error.message)
  } else {
    const { data, error } = await supabaseAdmin
      .from('automacoes_marketing')
      .insert(campos)
      .select('id')
      .single<{ id: string }>()
    if (error) throw new Error(error.message)
    automacaoId = data.id
  }

  // Passos são reescritos por inteiro — a ordem na tela é a ordem que vale.
  await supabaseAdmin.from('automacao_passos').delete().eq('automacao_id', automacaoId)
  if (d.passos.length > 0) {
    const linhas = d.passos.map((p, i) => ({
      automacao_id: automacaoId,
      ordem: i + 1,
      espera_dias: Math.max(0, p.esperaDias),
      template_id: p.templateId,
      ativo: p.ativo ?? true,
    }))
    const { error } = await supabaseAdmin.from('automacao_passos').insert(linhas)
    if (error) throw new Error(error.message)
  }
  return automacaoId
}

export async function definirStatusAutomacao(id: string, status: StatusAutomacao): Promise<void> {
  await supabaseAdmin
    .from('automacoes_marketing')
    .update({ status, atualizado_em: new Date().toISOString() })
    .eq('id', id)
}

export async function excluirAutomacao(id: string): Promise<void> {
  await supabaseAdmin.from('automacoes_marketing').delete().eq('id', id)
}

// ─────────────────────────────────────────────────────────────
// Gatilhos
// ─────────────────────────────────────────────────────────────

type InfoPedido = {
  pago: boolean
  mexidoEm: number
  /** Etapa da view pedidos_assistente_etapas (null se a view não respondeu). */
  etapa: string | null
  /** Quando entrou na etapa atual (ms). */
  desdeMs: number
}

/** Estado dos pedidos do chat, indexado por id — base dos gatilhos de pedido.
 *  Lê a view de etapas (D-8); se ela falhar, cai na tabela e os gatilhos por
 *  etapa simplesmente não casam com ninguém nessa rodada. */
async function mapaDePedidos(): Promise<Map<string, InfoPedido>> {
  const m = new Map<string, InfoPedido>()
  const view = await supabaseAdmin
    .from('pedidos_assistente_etapas')
    .select('id, pagamento_status, atualizado_em, criado_em, etapa, desde')
    .limit(5000)
  if (!view.error) {
    for (const p of (view.data ?? []) as Array<{
      id: string
      pagamento_status: string | null
      atualizado_em: string | null
      criado_em: string
      etapa: string
      desde: string
    }>) {
      m.set(p.id, {
        pago: p.pagamento_status === 'pago',
        mexidoEm: new Date(p.atualizado_em ?? p.criado_em).getTime(),
        etapa: p.etapa,
        desdeMs: new Date(p.desde).getTime(),
      })
    }
    return m
  }
  console.error('[automacoes] view de etapas falhou, usando a tabela', { erro: view.error.message })
  const { data } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, pagamento_status, atualizado_em, criado_em')
    .limit(5000)
  for (const p of (data ?? []) as Array<{
    id: string
    pagamento_status: string | null
    atualizado_em: string | null
    criado_em: string
  }>) {
    const mexidoEm = new Date(p.atualizado_em ?? p.criado_em).getTime()
    m.set(p.id, { pago: p.pagamento_status === 'pago', mexidoEm, etapa: null, desdeMs: mexidoEm })
  }
  return m
}

/** Quem, hoje, satisfaz o gatilho do fluxo (antes de checar canal/duplicidade). */
export function leadsDoGatilho(
  leads: Lead[],
  pedidos: Map<string, InfoPedido>,
  a: Pick<Automacao, 'gatilho' | 'gatilhoDias' | 'gatilhoMinutos'>,
  agoraMs: number
): Lead[] {
  // Minutos quando definido; senão o comportamento antigo, em dias. O primeiro
  // toque da régua de pedido incompleto é de 20 min — o cliente acabou de sair
  // do site e ainda está com o assunto na cabeça.
  const espera = a.gatilhoMinutos != null ? a.gatilhoMinutos * 60 * 1000 : a.gatilhoDias * 24 * 60 * 60 * 1000
  const corte = agoraMs - espera

  return leads.filter((l) => {
    if (l.optOut) return false
    const criadoMs = new Date(l.criadoEm).getTime()
    const pedido = l.pedidoId ? pedidos.get(l.pedidoId) : undefined
    const ultimoContatoMs = l.ultimoContatoEm ? new Date(l.ultimoContatoEm).getTime() : 0

    switch (a.gatilho) {
      case 'lead_novo':
        // Janela curta de propósito: ligar o fluxo não deve varrer a base velha.
        return criadoMs >= corte

      case 'pedido_parado':
        return !!pedido && !pedido.pago && pedido.mexidoEm <= corte

      case 'pos_compra':
        return !!pedido && pedido.pago && pedido.mexidoEm <= corte

      case 'lead_frio':
        return (
          l.status !== 'cliente' &&
          !pedido?.pago &&
          criadoMs <= corte &&
          ultimoContatoMs <= corte
        )

      default: {
        // Gatilhos por etapa: está na etapa e entrou nela há pelo menos X dias.
        const etapa = ETAPA_DO_GATILHO[a.gatilho]
        return !!etapa && !!pedido && pedido.etapa === etapa && pedido.desdeMs <= corte
      }
    }
  })
}

/** O gatilho ainda vale pra esse lead? (Reavaliado na hora de cada envio.) */
function continuaElegivel(l: Lead, pedidos: Map<string, InfoPedido>, gatilho: Gatilho): string | null {
  if (l.optOut) return 'descadastrou'
  const pedido = l.pedidoId ? pedidos.get(l.pedidoId) : undefined
  if ((gatilho === 'pedido_parado' || gatilho === 'lead_frio') && (pedido?.pago || l.status === 'cliente')) {
    return 'comprou'
  }
  const etapa = ETAPA_DO_GATILHO[gatilho]
  if (etapa) {
    if (pedido?.pago) return 'comprou'
    // Mudou de etapa (completou, confirmou, respondeu, foi encerrado…): a régua para.
    if (!pedido || pedido.etapa !== etapa) return 'mudou_de_etapa'
  }
  return null
}

// ─────────────────────────────────────────────────────────────
// Detalhe (D-10): regras em texto e o que o fluxo faria agora, sem mandar nada
// ─────────────────────────────────────────────────────────────

export type DetalheAutomacao = {
  /** Regras em texto, na ordem em que o motor aplica. */
  regras: string[]
  /** Quem entraria no fluxo na próxima rodada (ainda não inscrito). */
  entrariam: Array<{ leadId: string; nome: string | null; telefone: string | null; email: string | null; etapa: string | null; diasNaEtapa: number | null; alcancavel: boolean }>
  totalEntrariam: number
  /** Quem já está dentro e tem passo vencido — receberia mensagem na próxima rodada. */
  receberiamAgora: Array<{ leadId: string; nome: string | null; passoOrdem: number; enviados: number }>
  totalReceberiamAgora: number
  /** Quem está dentro esperando o próximo passo. */
  aguardando: number
  janelaAbertaAgora: boolean
}

export async function detalheAutomacao(id: string): Promise<DetalheAutomacao | null> {
  const a = await obterAutomacao(id)
  if (!a) return null

  const [leads, pedidos] = await Promise.all([
    listarLeadsCompleto({ ...a.publico, incluirOptOut: false }),
    mapaDePedidos(),
  ])
  const candidatos = leadsDoGatilho(leads, pedidos, a, Date.now())

  const dentro = new Map<string, { passo_ordem: number; enviados: number; status: string; proximo_em: string | null }>()
  const { data: execs } = await supabaseAdmin
    .from('automacao_execucoes')
    .select('lead_id, passo_ordem, enviados, status, proximo_em')
    .eq('automacao_id', a.id)
    .limit(5000)
  for (const e of (execs ?? []) as Array<{ lead_id: string; passo_ordem: number; enviados: number; status: string; proximo_em: string | null }>) {
    dentro.set(e.lead_id, e)
  }

  const passosAtivos = a.passos.filter((p) => p.ativo && p.templateId)
  const primeiroCanal = passosAtivos[0]?.templateId ? (await obterTemplate(passosAtivos[0].templateId))?.canal ?? null : null

  const novos = candidatos.filter((l) => !dentro.has(l.id))
  const entrariam = novos.slice(0, 40).map((l) => {
    const p = l.pedidoId ? pedidos.get(l.pedidoId) : undefined
    return {
      leadId: l.id,
      nome: l.nome,
      telefone: l.telefone,
      email: l.email,
      etapa: p?.etapa ?? null,
      diasNaEtapa: p ? Math.floor((Date.now() - p.desdeMs) / 86400_000) : null,
      alcancavel: primeiroCanal ? leadAlcancavel(l, primeiroCanal) : true,
    }
  })

  const agoraIso = new Date().toISOString()
  const porId = new Map(leads.map((l) => [l.id, l]))
  const vencidos: DetalheAutomacao['receberiamAgora'] = []
  let aguardando = 0
  for (const [leadId, e] of dentro) {
    if (e.status !== 'ativa') continue
    if (e.proximo_em && e.proximo_em <= agoraIso) {
      const l = porId.get(leadId)
      vencidos.push({ leadId, nome: l?.nome ?? null, passoOrdem: e.passo_ordem, enviados: e.enviados })
    } else {
      aguardando++
    }
  }

  const etapa = ETAPA_DO_GATILHO[a.gatilho]
  const regras: string[] = [
    `Gatilho: ${GATILHO_LABEL[a.gatilho]} — ${GATILHO_AJUDA[a.gatilho].replace('X dias', `${a.gatilhoDias} ${a.gatilhoDias === 1 ? 'dia' : 'dias'}`)}`,
    etapa
      ? `Sai do fluxo quando o pedido deixa a etapa "${etapa}" (paga, avança, é encerrado) ou o lead se descadastra.`
      : 'Sai do fluxo quando compra, vira cliente ou se descadastra.',
    `Público: ${descreverPublico(a.publico)}.`,
    `Janela de envio: ${a.horaInicio}h às ${a.horaFim}h (Recife); o robô roda de hora em hora e manda no máximo ${MAX_POR_RODADA} por rodada.`,
    `Teto: ${a.maxToques} ${a.maxToques === 1 ? 'toque' : 'toques'} por pessoa neste fluxo; ninguém entra duas vezes.`,
    `Passos: ${passosAtivos.length === 0 ? 'nenhum com template — não roda' : passosAtivos.map((p) => `${p.esperaDias === 0 ? 'na hora' : `+${p.esperaDias} d`}`).join(' → ')}.`,
    'Só manda com o canal do passo disponível (WhatsApp precisa de telefone; e-mail, de e-mail).',
  ]

  const hora = horaEmRecife()
  return {
    regras,
    entrariam,
    totalEntrariam: novos.length,
    receberiamAgora: vencidos.slice(0, 40),
    totalReceberiamAgora: vencidos.length,
    aguardando,
    janelaAbertaAgora: hora >= a.horaInicio && hora < a.horaFim,
  }
}

function descreverPublico(p: FiltroLeads): string {
  const partes: string[] = []
  if (p.uf) partes.push(`UF ${p.uf}`)
  if (p.origem && p.origem !== 'todas') partes.push(`origem ${p.origem}`)
  if (p.status && p.status !== 'todos') partes.push(`status ${p.status}`)
  if (p.tag) partes.push(`tag ${p.tag}`)
  if (p.canal && p.canal !== 'todos') partes.push(`com ${p.canal}`)
  if (p.busca) partes.push(`busca "${p.busca}"`)
  return partes.length ? partes.join(', ') : 'toda a base (sem descadastrados)'
}

// ─────────────────────────────────────────────────────────────
// Rodada
// ─────────────────────────────────────────────────────────────

/** Hora atual em Recife (o fuso do negócio, não o do servidor). */
export function horaEmRecife(agora = new Date()): number {
  return Number(
    new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Recife', hour: '2-digit', hour12: false }).format(agora)
  )
}

export type ResultadoRodada = {
  automacao: string
  status: StatusAutomacao
  inscritos: number
  enviados: number
  erros: number
  sairam: number
  pendentes: number
  observacao?: string
}

export async function rodarAutomacao(id: string, opts?: { forcar?: boolean }): Promise<ResultadoRodada> {
  const a = await obterAutomacao(id)
  if (!a) throw new Error('Fluxo não encontrado')

  const base: ResultadoRodada = {
    automacao: a.nome,
    status: a.status,
    inscritos: 0,
    enviados: 0,
    erros: 0,
    sairam: 0,
    pendentes: 0,
  }

  if (a.status !== 'ativa' && !opts?.forcar) {
    return { ...base, observacao: 'fluxo não está ativo' }
  }
  const passosAtivos = a.passos.filter((p) => p.ativo && p.templateId)
  if (passosAtivos.length === 0) {
    return { ...base, observacao: 'fluxo sem passos com template' }
  }
  const hora = horaEmRecife()
  if (hora < a.horaInicio || hora >= a.horaFim) {
    return { ...base, observacao: `fora da janela de envio (${a.horaInicio}h–${a.horaFim}h)` }
  }

  const [leads, pedidos] = await Promise.all([
    listarLeadsCompleto({ ...a.publico, incluirOptOut: false }),
    mapaDePedidos(),
  ])
  const porId = new Map(leads.map((l) => [l.id, l]))

  base.inscritos = await inscrever(a, leads, pedidos, passosAtivos[0].esperaDias)
  const exec = await executarVencidos(a, porId, pedidos)

  await supabaseAdmin
    .from('automacoes_marketing')
    .update({ ultima_rodada_em: new Date().toISOString() })
    .eq('id', a.id)

  return { ...base, ...exec }
}

/** Coloca no fluxo quem passou a ser elegível e ainda não entrou. */
async function inscrever(
  a: Automacao,
  leads: Lead[],
  pedidos: Map<string, InfoPedido>,
  esperaPrimeiroPasso: number
): Promise<number> {
  const candidatos = leadsDoGatilho(leads, pedidos, a, Date.now())
  if (candidatos.length === 0) return 0

  // Quem já está no fluxo — consultado em fatias pra não estourar a URL do
  // PostgREST quando o público é grande.
  const dentro = new Set<string>()
  for (let i = 0; i < candidatos.length; i += 200) {
    const { data: jaTem } = await supabaseAdmin
      .from('automacao_execucoes')
      .select('lead_id')
      .eq('automacao_id', a.id)
      .in('lead_id', candidatos.slice(i, i + 200).map((l) => l.id))
    for (const e of (jaTem ?? []) as Array<{ lead_id: string }>) dentro.add(e.lead_id)
  }

  const novos = candidatos.filter((l) => !dentro.has(l.id))
  if (novos.length === 0) return 0

  const proximo = new Date(Date.now() + esperaPrimeiroPasso * 24 * 60 * 60 * 1000).toISOString()
  const { error } = await supabaseAdmin.from('automacao_execucoes').upsert(
    novos.map((l) => ({ automacao_id: a.id, lead_id: l.id, proximo_em: proximo })),
    { onConflict: 'automacao_id,lead_id', ignoreDuplicates: true }
  )
  if (error) {
    console.error('[automacoes] falha ao inscrever', { automacao: a.id, error })
    return 0
  }
  return novos.length
}

type ExecucaoRow = {
  id: string
  lead_id: string
  passo_ordem: number
  enviados: number
  motivo_saida: string | null
}

/** Manda os passos que venceram, respeitando o cap da rodada. */
async function executarVencidos(
  a: Automacao,
  leadsPorId: Map<string, Lead>,
  pedidos: Map<string, InfoPedido>
): Promise<{ enviados: number; erros: number; sairam: number; pendentes: number }> {
  const agora = new Date().toISOString()
  const { data: vencidas } = await supabaseAdmin
    .from('automacao_execucoes')
    .select('id, lead_id, passo_ordem, enviados, motivo_saida')
    .eq('automacao_id', a.id)
    .eq('status', 'ativa')
    .lte('proximo_em', agora)
    .order('proximo_em', { ascending: true })
    .limit(MAX_POR_RODADA)

  let enviados = 0
  let erros = 0
  let sairam = 0

  const cacheTemplates = new Map<string, TemplateMarketing | null>()
  const pegarTemplate = async (id: string) => {
    if (!cacheTemplates.has(id)) cacheTemplates.set(id, await obterTemplate(id))
    return cacheTemplates.get(id) ?? null
  }

  for (const e of (vencidas ?? []) as ExecucaoRow[]) {
    const lead = leadsPorId.get(e.lead_id)

    // Saiu do público do fluxo (mudou de UF, virou opt-out, foi excluído…).
    if (!lead) {
      await encerrar(e.id, 'saiu', 'não está mais no público do fluxo')
      sairam++
      continue
    }
    const motivo = continuaElegivel(lead, pedidos, a.gatilho)
    if (motivo) {
      await encerrar(e.id, 'saiu', motivo)
      sairam++
      continue
    }
    if (e.enviados >= a.maxToques) {
      await encerrar(e.id, 'concluida', 'teto de toques do fluxo')
      continue
    }

    const passo = a.passos.find((p) => p.ordem > e.passo_ordem && p.ativo && p.templateId)
    if (!passo || !passo.templateId) {
      await encerrar(e.id, 'concluida', 'chegou ao fim do fluxo')
      continue
    }

    const template = await pegarTemplate(passo.templateId)
    if (!template) {
      await encerrar(e.id, 'saiu', 'template do passo foi removido')
      sairam++
      continue
    }
    if (!leadAlcancavel(lead, template.canal)) {
      await encerrar(e.id, 'saiu', `lead sem ${rotuloCanal(template.canal)}`)
      sairam++
      continue
    }

    const r = await enviarConteudo(conteudoDoTemplate(template), lead)

    if (r.naoEnviavel) {
      // Mala direta não sai por aqui — o passo é pulado e a peça entra na
      // lista de postagem que o admin gera à mão.
      await avancar(a, e, passo.ordem, e.enviados)
      continue
    }

    if (!r.ok) {
      erros++
      if (e.motivo_saida) {
        // Segundo erro seguido no mesmo passo: para de insistir.
        await encerrar(e.id, 'saiu', `falha repetida no envio: ${r.erro ?? 'desconhecida'}`)
        sairam++
      } else {
        await supabaseAdmin
          .from('automacao_execucoes')
          .update({
            proximo_em: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            motivo_saida: r.erro ?? 'falha no envio',
            atualizado_em: agora,
          })
          .eq('id', e.id)
      }
      continue
    }

    enviados++
    await supabaseAdmin.from('contatos_marketing').insert({
      lead_id: lead.id,
      pedido_id: lead.pedidoId,
      automacao_id: a.id,
      template_id: template.id,
      tipo: 'nutricao',
      origem: 'automatico',
      canal: template.canal === 'email' ? 'email' : 'whatsapp',
      mensagem: r.mensagem,
    })
    await registrarToque(lead.id)
    await avancar(a, e, passo.ordem, e.enviados + 1)
  }

  const { count } = await supabaseAdmin
    .from('automacao_execucoes')
    .select('id', { count: 'exact', head: true })
    .eq('automacao_id', a.id)
    .eq('status', 'ativa')
    .lte('proximo_em', new Date().toISOString())

  return { enviados, erros, sairam, pendentes: count ?? 0 }
}

function rotuloCanal(c: CanalEnvio): string {
  return c === 'email' ? 'e-mail' : c === 'mala_direta' ? 'endereço' : 'WhatsApp'
}

/** Marca o passo como feito e agenda o próximo (ou fecha o fluxo pro lead). */
async function avancar(a: Automacao, e: ExecucaoRow, ordemFeita: number, enviados: number): Promise<void> {
  const proximoPasso = a.passos.find((p) => p.ordem > ordemFeita && p.ativo && p.templateId)
  const agora = new Date().toISOString()

  if (!proximoPasso || enviados >= a.maxToques) {
    await supabaseAdmin
      .from('automacao_execucoes')
      .update({
        passo_ordem: ordemFeita,
        enviados,
        status: 'concluida',
        proximo_em: null,
        motivo_saida: null,
        atualizado_em: agora,
      })
      .eq('id', e.id)
    return
  }

  await supabaseAdmin
    .from('automacao_execucoes')
    .update({
      passo_ordem: ordemFeita,
      enviados,
      proximo_em: new Date(Date.now() + proximoPasso.esperaDias * 24 * 60 * 60 * 1000).toISOString(),
      motivo_saida: null,
      atualizado_em: agora,
    })
    .eq('id', e.id)
}

async function encerrar(execucaoId: string, status: 'concluida' | 'saiu', motivo: string): Promise<void> {
  await supabaseAdmin
    .from('automacao_execucoes')
    .update({ status, motivo_saida: motivo, proximo_em: null, atualizado_em: new Date().toISOString() })
    .eq('id', execucaoId)
}

/** Todas as ativas — usado pelo cron. */
export async function rodarTodasAutomacoes(): Promise<ResultadoRodada[]> {
  const { data } = await supabaseAdmin.from('automacoes_marketing').select('id').eq('status', 'ativa').limit(20)
  const out: ResultadoRodada[] = []
  for (const a of (data ?? []) as Array<{ id: string }>) {
    try {
      out.push(await rodarAutomacao(a.id))
    } catch (e) {
      console.error('[automacoes] falha na rodada', { id: a.id, e })
    }
  }
  return out
}

/**
 * Simulação: quantos ENTRARIAM no fluxo agora, sem gravar nada.
 * É o que a tela mostra antes de você ativar.
 */
export async function previaAutomacao(
  gatilho: Gatilho,
  gatilhoDias: number,
  publico: FiltroLeads,
  canalPrimeiroPasso?: CanalEnvio
): Promise<{ total: number; alcancaveis: number; amostra: string[] }> {
  const [leads, pedidos] = await Promise.all([
    listarLeadsCompleto({ ...publico, incluirOptOut: false }),
    mapaDePedidos(),
  ])
  const alvo = leadsDoGatilho(leads, pedidos, { gatilho, gatilhoDias, gatilhoMinutos: null }, Date.now())
  const alcancaveis = canalPrimeiroPasso ? alvo.filter((l) => leadAlcancavel(l, canalPrimeiroPasso)) : alvo
  return {
    total: alvo.length,
    alcancaveis: alcancaveis.length,
    amostra: alcancaveis.slice(0, 8).map((l) => l.nome ?? l.email ?? l.telefone ?? 'sem nome'),
  }
}
