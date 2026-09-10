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
import { encerrarPedido } from './etapas-pedido'
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

/**
 * O que o passo faz quando vence.
 *
 * `encerrar_pedido` existe porque o fim de uma régua de pedido incompleto não é
 * uma mensagem — é parar. Mandar um quarto toque pra dizer "vamos parar de
 * insistir" é insistir mais uma vez com quem já ignorou três.
 */
export type AcaoPasso = 'mensagem' | 'encerrar_pedido'

export type PassoAutomacao = {
  id: string
  ordem: number
  esperaDias: number
  templateId: string | null
  acao: AcaoPasso
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
  /**
   * Idade MÁXIMA na etapa pra entrar no fluxo, em dias. Nulo = sem teto.
   *
   * O gatilho diz "faz pelo menos X que está parado"; isto diz "mas não faz
   * tanto tempo assim". Sem ele, ligar um fluxo novo varre o acervo inteiro na
   * primeira rodada — a pessoa que abriu pedido em junho recebe hoje uma
   * cobrança pra terminar, e a estreia da automação vira o dia em que a gente
   * incomodou a base toda de uma vez.
   */
  gatilhoMaxDias: number | null
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
  // Existiam no banco e faltavam AQUI e no SELECT — e por isso o gatilho de 20
  // minutos da régua virava 0 na prática: `daLinha` lia undefined, caía em
  // gatilhoDias (0) e o corte era "agora". A régua nunca rodou, então ninguém
  // recebeu nada; se tivesse rodado, teria cobrado no segundo em que o cliente
  // saísse do site. Coluna no banco só vale se alguém a seleciona.
  gatilho_minutos: number | null
  gatilho_max_dias: number | null
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
  acao: AcaoPasso | null
  ativo: boolean
}

const COLS_AUTO =
  'id, nome, descricao, gatilho, gatilho_dias, gatilho_minutos, gatilho_max_dias, publico, max_toques, hora_inicio, hora_fim, status, ultima_rodada_em, criado_em'

function daLinha(r: AutomacaoRow, passos: PassoRow[]): Automacao {
  return {
    id: r.id,
    nome: r.nome,
    descricao: r.descricao,
    gatilho: r.gatilho,
    gatilhoDias: r.gatilho_dias,
    gatilhoMinutos: r.gatilho_minutos ?? null,
    gatilhoMaxDias: r.gatilho_max_dias ?? null,
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
      .map((p) => ({
        id: p.id,
        ordem: p.ordem,
        esperaDias: p.espera_dias,
        templateId: p.template_id,
        acao: p.acao ?? 'mensagem',
        ativo: p.ativo,
      })),
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
    .select('id, automacao_id, ordem, espera_dias, template_id, acao, ativo')
    .in('automacao_id', linhas.map((a) => a.id))
  return linhas.map((a) => daLinha(a, (passos ?? []) as PassoRow[]))
}

export async function obterAutomacao(id: string): Promise<Automacao | null> {
  const { data } = await supabaseAdmin.from('automacoes_marketing').select(COLS_AUTO).eq('id', id).maybeSingle<AutomacaoRow>()
  if (!data) return null
  const { data: passos } = await supabaseAdmin
    .from('automacao_passos')
    .select('id, automacao_id, ordem, espera_dias, template_id, acao, ativo')
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
  gatilhoMinutos?: number | null
  gatilhoMaxDias?: number | null
  publico: FiltroLeads
  maxToques: number
  horaInicio?: number
  horaFim?: number
  status?: StatusAutomacao
  passos: Array<{ esperaDias: number; templateId: string | null; acao?: AcaoPasso; ativo?: boolean }>
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
    // Só grava quando veio no payload. O editor do admin não tem campo pra
    // estes dois, e escrever `null` por omissão apagaria o gatilho de minutos e
    // o teto de idade da régua no primeiro "salvar" — a mesma classe de bug que
    // o passo de ação teria tido.
    ...(d.gatilhoMinutos !== undefined ? { gatilho_minutos: d.gatilhoMinutos } : {}),
    ...(d.gatilhoMaxDias !== undefined ? { gatilho_max_dias: d.gatilhoMaxDias } : {}),
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
      acao: p.acao ?? 'mensagem',
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
  /** O cliente pediu tempo. Nenhum fluxo aborda enquanto isto for true. */
  lembretesPausados: boolean
}

/** Estado dos pedidos do chat, indexado por id — base dos gatilhos de pedido.
 *  Lê a view de etapas (D-8); se ela falhar, cai na tabela e os gatilhos por
 *  etapa simplesmente não casam com ninguém nessa rodada. */
async function mapaDePedidos(): Promise<Map<string, InfoPedido>> {
  const m = new Map<string, InfoPedido>()

  // Consulta à parte porque a view de etapas não expõe a coluna nova. É curta:
  // traz só quem está silenciado, que é a minoria.
  const pausados = new Set<string>()
  const { data: silenciados } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id')
    .gt('lembretes_pausados_ate', new Date().toISOString())
    .limit(5000)
  for (const p of (silenciados ?? []) as Array<{ id: string }>) pausados.add(p.id)

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
        lembretesPausados: pausados.has(p.id),
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
    m.set(p.id, {
      pago: p.pagamento_status === 'pago',
      mexidoEm,
      etapa: null,
      desdeMs: mexidoEm,
      lembretesPausados: pausados.has(p.id),
    })
  }
  return m
}

// ─────────────────────────────────────────────────────────────
// Conversa em andamento (09/09/2026)
//
// Um fluxo não fala por cima de uma conversa viva. Se a pessoa mandou mensagem
// nas últimas 24h, a janela do WhatsApp está aberta e o Luigi está atendendo
// ela agora — um template "posso tirar uma dúvida?" em cima disso é a máquina
// ignorando o que o cliente acabou de dizer.
//
// A comparação é pelos 8 últimos dígitos porque o mesmo celular aparece com e
// sem o nono dígito (5581 9xxxx-xxxx e 5581 xxxx-xxxx são a mesma pessoa).
// ─────────────────────────────────────────────────────────────

/** Fim do telefone (8 dígitos) — a chave que sobrevive ao nono dígito. */
export function fim8(telefone: string | null | undefined): string | null {
  const so = (telefone ?? '').replace(/\D/g, '')
  return so.length >= 8 ? so.slice(-8) : null
}

/**
 * Os números da casa nunca entram em fluxo de marketing.
 *
 * O Fernando testa o site com o próprio WhatsApp, e esses testes viram pedido
 * de verdade: o 20260700108 está parado em "captado" desde julho, com o número
 * dele. Sem essa trava, o primeiro fluxo ligado manda "posso tirar uma dúvida
 * sobre seu pedido?" pro dono da empresa.
 *
 * Lê a env direto em vez de importar de gestao-whatsapp: aquele módulo carrega
 * o agente inteiro (SDK, ferramentas), e automação não precisa de nada disso.
 */
function fim8DaCasa(): Set<string> {
  const out = new Set<string>()
  for (const n of (process.env.WHATSAPP_GESTAO_NUMEROS ?? '').split(',')) {
    const chave = fim8(n)
    if (chave) out.add(chave)
  }
  return out
}

/** Quem nos escreveu nas últimas `horas` — não recebe automação. */
export async function conversasQuentes(horas = 24): Promise<Set<string>> {
  const desde = new Date(Date.now() - horas * 60 * 60 * 1000).toISOString()

  // Três consultas simples em vez de um embed aninhado do PostgREST: se essa
  // leitura falhar, TODA automação para (é ela que autoriza o envio). Não vale
  // a pena depender de sintaxe de join pra economizar duas idas ao banco.
  const msgs = await supabaseAdmin
    .from('wa_mensagens')
    .select('conversa_id')
    .eq('direcao', 'entrada')
    .gte('criado_em', desde)
    .limit(2000)
  if (msgs.error) throw new Error(`conversas quentes indisponíveis: ${msgs.error.message}`)

  // Os números da casa entram na mesma lista: pro motor, "não escreva pra esse
  // número" é a mesma regra, e assim vale pra todo fluxo de uma vez.
  const out = fim8DaCasa()

  const conversaIds = [...new Set(((msgs.data ?? []) as Array<{ conversa_id: string }>).map((m) => m.conversa_id))]
  if (conversaIds.length === 0) return out

  const convs = await supabaseAdmin.from('wa_conversas').select('contato_id').in('id', conversaIds)
  if (convs.error) throw new Error(`conversas quentes indisponíveis: ${convs.error.message}`)

  const contatoIds = [...new Set(((convs.data ?? []) as Array<{ contato_id: string }>).map((c) => c.contato_id))]
  if (contatoIds.length === 0) return out

  const contatos = await supabaseAdmin.from('wa_contatos').select('wa_id').in('id', contatoIds)
  if (contatos.error) throw new Error(`conversas quentes indisponíveis: ${contatos.error.message}`)

  for (const c of (contatos.data ?? []) as Array<{ wa_id: string }>) {
    const chave = fim8(c.wa_id)
    if (chave) out.add(chave)
  }
  return out
}

/**
 * Pra quem A GENTE escreveu nas últimas `horas` — não entra em fluxo agora.
 *
 * POR QUE ISSO É SEPARADO DE conversasQuentes (09/09/2026)
 * Em 09/09 o agente de gestão mandou `duvida_pedido_tarde` na mão pra 5 pessoas
 * paradas em captado, às 14h54. Nenhuma respondeu, então nenhuma entrava em
 * `conversasQuentes` — que só olha mensagem de ENTRADA. No dia seguinte às 9h a
 * régua mandaria `duvida_pedido_manha` pras mesmas 5: a mesma pergunta, 18 horas
 * depois, como se a primeira nunca tivesse existido.
 *
 * Lê `wa_mensagens`, que registra o que sai pelo inbox, pelo Luigi e pelo
 * agente — mas NÃO o que a própria régua manda (isso vai pra contatos_marketing,
 * via envio-marketing.ts). Por isso essa trava não atrapalha a cadência do
 * fluxo: ela só impede a ENTRADA de quem acabou de ser abordado por outro
 * caminho. Depois de dentro, quem manda no ritmo é o fluxo.
 */
export async function falamosRecentemente(horas = 48): Promise<Set<string>> {
  const desde = new Date(Date.now() - horas * 60 * 60 * 1000).toISOString()
  const out = new Set<string>()

  const msgs = await supabaseAdmin
    .from('wa_mensagens')
    .select('conversa_id')
    .eq('direcao', 'saida')
    .gte('criado_em', desde)
    .limit(2000)
  if (msgs.error) throw new Error(`últimos envios indisponíveis: ${msgs.error.message}`)

  const conversaIds = [...new Set(((msgs.data ?? []) as Array<{ conversa_id: string }>).map((m) => m.conversa_id))]
  if (conversaIds.length === 0) return out

  const convs = await supabaseAdmin.from('wa_conversas').select('contato_id').in('id', conversaIds)
  if (convs.error) throw new Error(`últimos envios indisponíveis: ${convs.error.message}`)

  const contatoIds = [...new Set(((convs.data ?? []) as Array<{ contato_id: string }>).map((c) => c.contato_id))]
  if (contatoIds.length === 0) return out

  const contatos = await supabaseAdmin.from('wa_contatos').select('wa_id').in('id', contatoIds)
  if (contatos.error) throw new Error(`últimos envios indisponíveis: ${contatos.error.message}`)

  for (const c of (contatos.data ?? []) as Array<{ wa_id: string }>) {
    const chave = fim8(c.wa_id)
    if (chave) out.add(chave)
  }
  return out
}

/** Quem, hoje, satisfaz o gatilho do fluxo (antes de checar canal/duplicidade). */
export function leadsDoGatilho(
  leads: Lead[],
  pedidos: Map<string, InfoPedido>,
  a: Pick<Automacao, 'gatilho' | 'gatilhoDias' | 'gatilhoMinutos' | 'gatilhoMaxDias'>,
  agoraMs: number,
  quentes?: Set<string>
): Lead[] {
  // Minutos quando definido; senão o comportamento antigo, em dias. O primeiro
  // toque da régua de pedido incompleto é de 20 min — o cliente acabou de sair
  // do site e ainda está com o assunto na cabeça.
  const espera = a.gatilhoMinutos != null ? a.gatilhoMinutos * 60 * 1000 : a.gatilhoDias * 24 * 60 * 60 * 1000
  const corte = agoraMs - espera

  return leads.filter((l) => {
    if (l.optOut) return false
    // Conversa aberta: o Luigi está com essa pessoa. O fluxo não entra por cima.
    const chave = fim8(l.telefone)
    if (quentes && chave && quentes.has(chave)) return false
    const criadoMs = new Date(l.criadoEm).getTime()
    const pedido = l.pedidoId ? pedidos.get(l.pedidoId) : undefined
    // Pediu tempo ("só mês que vem", "to vendo ainda"): nenhum fluxo entra.
    // Insistir com quem já disse quando volta é o que faz a gente parecer chato.
    if (pedido?.lembretesPausados) return false
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
        // Gatilhos por etapa: está na etapa, entrou nela há pelo menos X — e,
        // quando há teto, não faz mais tempo do que o teto. O teto é o que
        // impede a estreia de um fluxo de varrer o acervo parado de uma vez.
        const etapa = ETAPA_DO_GATILHO[a.gatilho]
        if (!etapa || !pedido || pedido.etapa !== etapa || pedido.desdeMs > corte) return false
        if (a.gatilhoMaxDias == null) return true
        return pedido.desdeMs >= agoraMs - a.gatilhoMaxDias * 24 * 60 * 60 * 1000
      }
    }
  })
}

/** O gatilho ainda vale pra esse lead? (Reavaliado na hora de cada envio.) */
function continuaElegivel(
  l: Lead,
  pedidos: Map<string, InfoPedido>,
  gatilho: Gatilho,
  quentes?: Set<string>
): string | null {
  if (l.optOut) return 'descadastrou'
  // Entre a inscrição e o envio podem passar dias. Se nesse meio-tempo a pessoa
  // escreveu, ela não é mais alvo de régua — é atendimento, e o passo espera.
  const chave = fim8(l.telefone)
  if (quentes && chave && quentes.has(chave)) return 'adiar_conversa_aberta'
  const pedido = l.pedidoId ? pedidos.get(l.pedidoId) : undefined
  // Pediu tempo depois de já estar no fluxo: sai agora, no meio da régua.
  if (pedido?.lembretesPausados) return 'cliente pediu pra falar depois'
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

  const [leads, pedidos, quentes, jaFalamos] = await Promise.all([
    listarLeadsCompleto({ ...a.publico, incluirOptOut: false }),
    mapaDePedidos(),
    conversasQuentes().catch(() => new Set<string>()),
    falamosRecentemente().catch(() => new Set<string>()),
  ])
  const candidatos = leadsDoGatilho(leads, pedidos, a, Date.now(), quentes).filter((l) => {
    const chave = fim8(l.telefone)
    return !(chave && jaFalamos.has(chave))
  })

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
    ...(a.passos.some((p) => p.ativo && p.esperaDias === 0)
      ? ['O passo "na hora" sai a QUALQUER hora: quem acabou de mexer no pedido ainda está ali. Os passos em dias esperam a janela.']
      : []),
    ...(a.gatilhoMaxDias != null
      ? [`Só entra quem está parado há no máximo ${a.gatilhoMaxDias} dias — pedido mais velho que isso a automação não reabre.`]
      : []),
    ...(a.passos.some((p) => p.ativo && p.acao === 'encerrar_pedido')
      ? ['O último passo ENCERRA o pedido incompleto, sem mandar mensagem nenhuma.']
      : []),
    'Quem pediu tempo ("só mês que vem") sai do fluxo: o Luigi silencia o pedido pelo prazo que o cliente deu.',
    `Teto: ${a.maxToques} ${a.maxToques === 1 ? 'toque' : 'toques'} por pessoa neste fluxo; ninguém entra duas vezes.`,
    `Passos: ${passosAtivos.length === 0 ? 'nenhum com template — não roda' : passosAtivos.map((p) => `${p.esperaDias === 0 ? 'na hora' : `+${p.esperaDias} d`}`).join(' → ')}.`,
    'Só manda com o canal do passo disponível (WhatsApp precisa de telefone; e-mail, de e-mail).',
    `Quem mandou mensagem nas últimas 24h não recebe: o passo espera mais um dia (${quentes.size} ${quentes.size === 1 ? 'pessoa está' : 'pessoas estão'} nessa situação agora).`,
    `Quem a gente abordou nas últimas 48h pelo inbox, pelo Luigi ou pelo agente não ENTRA agora — entra quando esfriar (${jaFalamos.size} ${jaFalamos.size === 1 ? 'número' : 'números'} nessa situação).`,
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
  /** Passos que venceram mas a pessoa estava conversando com a gente. */
  adiados: number
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
    adiados: 0,
    pendentes: 0,
  }

  if (a.status !== 'ativa' && !opts?.forcar) {
    return { ...base, observacao: 'fluxo não está ativo' }
  }
  const passosAtivos = a.passos.filter((p) => p.ativo && (p.templateId || p.acao === 'encerrar_pedido'))
  if (passosAtivos.length === 0) {
    return { ...base, observacao: 'fluxo sem passos com template' }
  }

  // A JANELA NÃO VALE PRO PASSO IMEDIATO — 10/09/2026.
  //
  // Até aqui a janela barrava a rodada inteira, e com isso o primeiro toque de
  // 15 minutos era uma ficção: quem parasse de responder às 15h05 só ouvia algo
  // às 14h do dia seguinte, quase 23 horas depois.
  //
  // O raciocínio do Fernando resolve isso e tem limite: quem abriu o pedido de
  // madrugada ESTÁ ali de madrugada, então o toque imediato pode sair a
  // qualquer hora — é continuação da sessão, não interrupção. Mas isso vale só
  // pro passo imediato. O lembrete de 24h cairia na mesma hora da noite
  // seguinte, quando a pessoa está dormindo, e aí é interrupção mesmo.
  //
  // Então: passo com espera 0 sai a qualquer hora; passo com espera em dias
  // espera a janela. Quem não pôde sair fica com `proximo_em` no passado e sai
  // na primeira rodada dentro do horário — nada se perde.
  const hora = horaEmRecife()
  const dentroDaJanela = hora >= a.horaInicio && hora < a.horaFim
  const temPassoImediato = passosAtivos.some((p) => p.esperaDias === 0)
  if (!dentroDaJanela && !temPassoImediato) {
    return { ...base, observacao: `fora da janela de envio (${a.horaInicio}h–${a.horaFim}h)` }
  }

  // `conversasQuentes` joga se a leitura falhar: sem saber quem está falando
  // com a gente agora, a rodada inteira para. Uma rodada perdida custa uma hora;
  // escrever por cima de 30 conversas abertas custa a confiança de 30 clientes.
  const [leads, pedidos, quentes, jaFalamos] = await Promise.all([
    listarLeadsCompleto({ ...a.publico, incluirOptOut: false }),
    mapaDePedidos(),
    conversasQuentes(),
    falamosRecentemente(),
  ])
  const porId = new Map(leads.map((l) => [l.id, l]))

  base.inscritos = await inscrever(a, leads, pedidos, passosAtivos[0].esperaDias, quentes, jaFalamos)
  const exec = await executarVencidos(a, porId, pedidos, quentes, dentroDaJanela)

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
  esperaPrimeiroPasso: number,
  quentes: Set<string>,
  jaFalamos: Set<string>
): Promise<number> {
  const candidatos = leadsDoGatilho(leads, pedidos, a, Date.now(), quentes).filter((l) => {
    // Abordado nas últimas 48h por outro caminho (inbox, Luigi, agente): não
    // começa régua em cima disso. Entra na próxima rodada, quando esfriar.
    const chave = fim8(l.telefone)
    return !(chave && jaFalamos.has(chave))
  })
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
  pedidos: Map<string, InfoPedido>,
  quentes: Set<string>,
  dentroDaJanela: boolean
): Promise<{ enviados: number; erros: number; sairam: number; adiados: number; pendentes: number }> {
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
  let adiados = 0

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
    const motivo = continuaElegivel(lead, pedidos, a.gatilho, quentes)
    // Conversa aberta ADIA, não elimina: o Luigi pode estar fechando o pedido
    // agora (e aí a pessoa muda de etapa e sai sozinha), ou a conversa pode
    // morrer sem resolver nada — e nesse caso a régua tem que continuar de onde
    // parou. Encerrar aqui perderia quem mais precisa do próximo toque.
    if (motivo === 'adiar_conversa_aberta') {
      await supabaseAdmin
        .from('automacao_execucoes')
        .update({ proximo_em: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), atualizado_em: agora })
        .eq('id', e.id)
      adiados++
      continue
    }
    if (motivo) {
      await encerrar(e.id, 'saiu', motivo)
      sairam++
      continue
    }
    if (e.enviados >= a.maxToques) {
      await encerrar(e.id, 'concluida', 'teto de toques do fluxo')
      continue
    }

    const passo = a.passos.find(
      (p) => p.ordem > e.passo_ordem && p.ativo && (p.templateId || p.acao === 'encerrar_pedido')
    )
    if (!passo) {
      await encerrar(e.id, 'concluida', 'chegou ao fim do fluxo')
      continue
    }

    // Passo com espera em dias só sai em horário decente. O imediato já saiu
    // acima, a qualquer hora, porque é continuação da sessão do cliente.
    if (passo.esperaDias > 0 && !dentroDaJanela) continue

    // Fim de régua que ENCERRA em vez de escrever. Silencioso de propósito:
    // quem ignorou os toques anteriores não quer mais um avisando que paramos.
    if (passo.acao === 'encerrar_pedido') {
      if (lead.pedidoId) {
        await encerrarPedidoDaRegua(lead.pedidoId, a.nome)
      }
      await encerrar(e.id, 'concluida', 'pedido incompleto encerrado pela régua')
      sairam++
      continue
    }
    if (!passo.templateId) {
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

  return { enviados, erros, sairam, adiados, pendentes: count ?? 0 }
}

/**
 * Encerra o pedido incompleto no fim da régua. Nunca lança.
 *
 * `encerrarPedido` recusa pedido pago ou já encerrado, e essa recusa aqui não é
 * erro: significa que a pessoa resolveu por outro caminho entre o último toque
 * e agora — que é o desfecho que a gente queria. Derrubar a rodada por causa
 * disso pararia a régua dos outros.
 */
async function encerrarPedidoDaRegua(pedidoId: string, fluxo: string): Promise<void> {
  try {
    await encerrarPedido(pedidoId, 'sumiu', 'regua', `encerrado pela régua "${fluxo}" após os toques sem resposta`)
  } catch (err) {
    console.error('[automacoes] não deu pra encerrar o pedido da régua', { pedidoId, err })
  }
}

function rotuloCanal(c: CanalEnvio): string {
  return c === 'email' ? 'e-mail' : c === 'mala_direta' ? 'endereço' : 'WhatsApp'
}

/** Marca o passo como feito e agenda o próximo (ou fecha o fluxo pro lead). */
async function avancar(a: Automacao, e: ExecucaoRow, ordemFeita: number, enviados: number): Promise<void> {
  // O passo seguinte pode ser uma AÇÃO em vez de uma mensagem — filtrar só por
  // template daria o fluxo por concluído antes do passo que encerra o pedido, e
  // a régua terminaria sem nunca encerrar nada.
  const proximoPasso = a.passos.find(
    (p) => p.ordem > ordemFeita && p.ativo && (p.templateId || p.acao === 'encerrar_pedido')
  )
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
      // A falha vai no retorno, não só no console: o cron responde JSON e é
      // esse JSON que a gente lê quando um fluxo "não mandou nada hoje".
      const erro = e instanceof Error ? e.message : String(e)
      console.error('[automacoes] falha na rodada', { id: a.id, erro })
      out.push({
        automacao: a.id,
        status: 'ativa',
        inscritos: 0,
        enviados: 0,
        erros: 1,
        sairam: 0,
        adiados: 0,
        pendentes: 0,
        observacao: `rodada falhou: ${erro}`,
      })
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
  // Prévia não manda nada, então se a leitura das conversas falhar ela só
  // deixa de descontar quem está conversando — mostra a mais, nunca a menos.
  const quentes = await conversasQuentes().catch(() => new Set<string>())
  const alvo = leadsDoGatilho(
    leads,
    pedidos,
    { gatilho, gatilhoDias, gatilhoMinutos: null, gatilhoMaxDias: null },
    Date.now(),
    quentes
  )
  const alcancaveis = canalPrimeiroPasso ? alvo.filter((l) => leadAlcancavel(l, canalPrimeiroPasso)) : alvo
  return {
    total: alvo.length,
    alcancaveis: alcancaveis.length,
    amostra: alcancaveis.slice(0, 8).map((l) => l.nome ?? l.email ?? l.telefone ?? 'sem nome'),
  }
}
