// app/lib/gestao-whatsapp.ts
// ============================================================================
// AGENTE DE GESTÃO NO WHATSAPP — a reunião das 07:00 e das 17:30 (D-7).
//
// Como funciona:
//   1. O cron (/api/cron/reuniao-manha e /reuniao-tarde) monta a pauta a
//      partir do diário de bordo e manda pro WhatsApp do Fernando, pelo número
//      oficial da Confeccione: texto livre se a janela de 24 h estiver aberta,
//      senão o template `reuniao_gestao`.
//   2. Quando o Fernando responde, o webhook reconhece o número dele
//      (WHATSAPP_GESTAO_NUMEROS) e chama responderGestao(): o histórico da
//      conversa vira contexto, o Claude consulta o diário pelas ferramentas
//      abaixo, responde curto e a resposta sai pela Cloud API.
//
// O que o agente pode fazer aqui: LER (placar, filas, decisões, atas) e
// REGISTRAR (decisão, ata, pendência feita, foto do placar). O que ele NÃO
// pode: mandar mensagem a cliente ou fornecedor, cobrar, mexer em pedido —
// não existe ferramenta pra isso, de propósito (níveis de autonomia, seção 3
// do sistema operacional). Só responde a números da allowlist.
//
// Cada resposta fica em gestao_whatsapp_log (mensagem, resposta, ferramentas,
// tokens, erro): é o que permite treinar o agente lendo onde ele errou.
// ============================================================================

import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from './supabase-server'
import { enviarTemplate, enviarTexto, marcarComoLida, normalizarWaId } from './whatsapp-cloud'
import { janela24hAberta, registrarSaidaInbox } from './whatsapp-notify'
import { registrarUsoIa } from './uso-ia'
import {
  concluirPendencia,
  conversasSemResposta,
  filaCobranca,
  gravarPlacar,
  listarDecisoes,
  pedidosSemFornecedor,
  registrarDecisao,
  registrarReuniao,
  resumoGestao,
  TEMAS_DECISAO,
  TIPOS_REUNIAO,
  type Pendencia,
  type TipoReuniao,
} from './diario'

const MODELO = 'claude-sonnet-4-6'
const MAX_RODADAS = 6
const MAX_TOKENS_RESPOSTA = 1200
const HISTORICO_MENSAGENS = 30
const LIMITE_TEXTO_WHATSAPP = 3500

/** Template de abertura fora da janela de 24 h: {{1}} = hora, {{2}} = resumo em uma linha. */
export const TEMPLATE_REUNIAO_GESTAO = 'reuniao_gestao'

export type TipoReuniaoDiaria = Extract<TipoReuniao, 'manha' | 'tarde'>

// ─── Quem é gestor ──────────────────────────────────────────────────────────

/** Números (wa_id) que o agente atende. Vem de WHATSAPP_GESTAO_NUMEROS, separados por vírgula. */
export function numerosGestao(): string[] {
  return (process.env.WHATSAPP_GESTAO_NUMEROS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizarWaId)
    .filter((n) => n.replace(/\D/g, '').length >= 10)
}

export function ehNumeroGestao(waId: string): boolean {
  const alvo = normalizarWaId(waId)
  return numerosGestao().some((n) => n === alvo || n.slice(-8) === alvo.slice(-8))
}

// ─── Utilidades ─────────────────────────────────────────────────────────────

function agoraRecife(): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Recife',
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date())
}

export function horaRecife(agora = new Date()): number {
  return Number(new Intl.DateTimeFormat('en', { timeZone: 'America/Recife', hour: 'numeric', hour12: false }).format(agora))
}

function reais(centavos: number | null | undefined): string {
  return (Number(centavos ?? 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** Markdown vira o pouco que o WhatsApp entende: *negrito*, sem títulos, sem tabelas. */
function paraWhatsApp(texto: string): string {
  return texto
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/^\s*[-•]\s+/gm, '- ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Quebra em blocos de até LIMITE_TEXTO_WHATSAPP chars, de preferência em parágrafo. */
function partirTexto(texto: string): string[] {
  if (texto.length <= LIMITE_TEXTO_WHATSAPP) return [texto]
  const partes: string[] = []
  let resto = texto
  while (resto.length > LIMITE_TEXTO_WHATSAPP) {
    let corte = resto.lastIndexOf('\n\n', LIMITE_TEXTO_WHATSAPP)
    if (corte < LIMITE_TEXTO_WHATSAPP / 2) corte = resto.lastIndexOf('\n', LIMITE_TEXTO_WHATSAPP)
    if (corte < LIMITE_TEXTO_WHATSAPP / 2) corte = LIMITE_TEXTO_WHATSAPP
    partes.push(resto.slice(0, corte).trim())
    resto = resto.slice(corte).trim()
  }
  if (resto) partes.push(resto)
  return partes
}

function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ─── Envio pro gestor ───────────────────────────────────────────────────────

export type EnvioGestor = { ok: true; wamid: string; template: string | null } | { ok: false; erro: string }

/**
 * Manda texto pro gestor. Dentro da janela de 24 h vai como texto livre; fora,
 * só o template de abertura passa — o texto completo fica pra primeira
 * resposta do agente. Espelha no inbox pra história ficar em /admin/whatsapp.
 */
export async function enviarParaGestor(
  waId: string,
  texto: string,
  abertura: { hora: string; resumo: string }
): Promise<EnvioGestor> {
  const partes = partirTexto(texto)
  if (await janela24hAberta(waId)) {
    let ultimo: EnvioGestor = { ok: false, erro: 'nada enviado' }
    for (const parte of partes) {
      const r = await enviarTexto(waId, parte)
      if (!r.ok) return { ok: false, erro: r.erro }
      await registrarSaidaInbox(waId, null, r.wamid, parte, null)
      ultimo = { ok: true, wamid: r.wamid, template: null }
    }
    return ultimo
  }

  const resumo = abertura.resumo.replace(/\s*\n+\s*/g, ' · ').replace(/\s{2,}/g, ' ').trim().slice(0, 300)
  const r = await enviarTemplate(waId, TEMPLATE_REUNIAO_GESTAO, 'pt_BR', [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: abertura.hora },
        { type: 'text', text: resumo },
      ],
    },
  ])
  if (!r.ok) return { ok: false, erro: r.erro }
  await registrarSaidaInbox(
    waId,
    null,
    r.wamid,
    `Fernando, a pauta da reunião das ${abertura.hora} está pronta: ${resumo}. Responde aqui pra começarmos.`,
    TEMPLATE_REUNIAO_GESTAO
  )
  return { ok: true, wamid: r.wamid, template: TEMPLATE_REUNIAO_GESTAO }
}

// ─── Ferramentas do agente (só leitura e registro) ──────────────────────────

const FERRAMENTAS: Anthropic.Messages.Tool[] = [
  {
    name: 'resumo_gestao',
    description:
      'Placar de agora (7 e 30 dias + filas abertas), última foto gravada, decisões vencendo revisão, decisões recentes, ' +
      'pendências abertas das últimas atas e últimas reuniões. Comece por aqui em toda reunião.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'fila_cobranca',
    description: 'Quem tem orçamento definido e ainda não pagou (pedidos do chat + orçamentos avulsos com cobrança gerada), do mais antigo pro mais novo.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'conversas_sem_resposta',
    description: 'Conversas do WhatsApp oficial em que a última mensagem é do contato e está sem resposta há mais de N horas (padrão 2).',
    input_schema: { type: 'object', properties: { horas: { type: 'number', minimum: 1, maximum: 168 } } },
  },
  {
    name: 'pedidos_sem_fornecedor',
    description: 'Pedidos confirmados sem nenhuma oferta aceita há mais de N horas (padrão 24), com ofertas no ar e recusadas.',
    input_schema: { type: 'object', properties: { horas: { type: 'number', minimum: 1, maximum: 720 } } },
  },
  {
    name: 'buscar_decisoes',
    description: 'Decisões do diário de bordo (D-1, D-2…). Consulte antes de propor algo que pode já ter sido decidido.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['vigente', 'revisada', 'revogada', 'todas'] },
        tema: { type: 'string', enum: [...TEMAS_DECISAO] },
        texto: { type: 'string', description: 'Busca em título, decisão, contexto e motivo.' },
        para_revisar: { type: 'boolean', description: 'Só as vigentes com revisão vencida.' },
        limite: { type: 'integer', minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: 'registrar_decisao',
    description:
      'Grava uma decisão que o FERNANDO tomou nesta conversa, de forma explícita. Nunca registre sugestão sua como decisão. ' +
      'Inclua alternativas descartadas, motivo e uma data de revisão.',
    input_schema: {
      type: 'object',
      properties: {
        tema: { type: 'string', enum: [...TEMAS_DECISAO] },
        titulo: { type: 'string', maxLength: 140 },
        decisao: { type: 'string', description: 'O que passa a valer, em uma ou duas frases.' },
        contexto: { type: 'string' },
        alternativas: { type: 'string' },
        motivo: { type: 'string' },
        revisar_em: { type: 'string', description: 'AAAA-MM-DD' },
      },
      required: ['tema', 'titulo', 'decisao'],
    },
  },
  {
    name: 'registrar_reuniao',
    description:
      'Grava a ata da reunião (tipo manha ou tarde nas diárias) quando ela termina: o que foi olhado, o que foi decidido, ' +
      'pendências com dono e prazo. Registre quando o Fernando encerrar ou pedir.',
    input_schema: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: [...TIPOS_REUNIAO] },
        titulo: { type: 'string', maxLength: 140 },
        resumo: { type: 'string', description: 'A ata, curta, em texto corrido ou linhas com -.' },
        pauta: { type: 'string' },
        pendencias: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              descricao: { type: 'string' },
              dono: { type: 'string', description: 'Fernando, agente, ou o nome de quem faz.' },
              prazo: { type: 'string', description: 'AAAA-MM-DD' },
            },
            required: ['descricao'],
          },
        },
      },
      required: ['tipo', 'titulo', 'resumo'],
    },
  },
  {
    name: 'concluir_pendencia',
    description: 'Marca como feita a pendência aberta (das últimas atas) cuja descrição contém o trecho informado.',
    input_schema: {
      type: 'object',
      properties: { trecho: { type: 'string', minLength: 3, description: 'Parte da descrição da pendência.' } },
      required: ['trecho'],
    },
  },
  {
    name: 'gravar_placar',
    description: 'Tira a foto da semana (placar_semanal). Use na reunião de segunda ou quando o Fernando pedir; regravar substitui a foto da semana.',
    input_schema: { type: 'object', properties: { observacoes: { type: 'string' } } },
  },
]

type Entrada = Record<string, unknown>

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

async function executarFerramenta(nome: string, entrada: Entrada): Promise<unknown> {
  switch (nome) {
    case 'resumo_gestao':
      return await resumoGestao()
    case 'fila_cobranca': {
      const fila = await filaCobranca()
      return fila.slice(0, 40).map((i) => ({ ...i, valor: reais(i.valor_centavos) }))
    }
    case 'conversas_sem_resposta':
      return (await conversasSemResposta(num(entrada.horas) ?? 2)).slice(0, 40)
    case 'pedidos_sem_fornecedor':
      return (await pedidosSemFornecedor(num(entrada.horas) ?? 24)).slice(0, 40).map((p) => ({ ...p, valor: reais(p.valor_centavos) }))
    case 'buscar_decisoes': {
      const status = str(entrada.status) as 'vigente' | 'revisada' | 'revogada' | 'todas' | undefined
      return await listarDecisoes({
        status: status ?? 'vigente',
        tema: str(entrada.tema),
        texto: str(entrada.texto),
        paraRevisar: entrada.para_revisar === true,
        limite: num(entrada.limite) ?? 20,
      })
    }
    case 'registrar_decisao': {
      const tema = str(entrada.tema)
      const titulo = str(entrada.titulo)
      const decisao = str(entrada.decisao)
      if (!tema || !titulo || !decisao) throw new Error('tema, titulo e decisao são obrigatórios')
      const d = await registrarDecisao({
        tema,
        titulo,
        decisao,
        contexto: str(entrada.contexto) ?? null,
        alternativas: str(entrada.alternativas) ?? null,
        motivo: str(entrada.motivo) ?? null,
        revisar_em: str(entrada.revisar_em) ?? null,
        documento: 'claude/sistema-operacional-escala.md',
        origem: 'whatsapp',
      })
      return { numero: `D-${d.numero}`, id: d.id, titulo: d.titulo, revisar_em: d.revisar_em }
    }
    case 'registrar_reuniao': {
      const tipo = str(entrada.tipo) as TipoReuniao | undefined
      const titulo = str(entrada.titulo)
      const resumo = str(entrada.resumo)
      if (!tipo || !TIPOS_REUNIAO.includes(tipo) || !titulo || !resumo) throw new Error('tipo, titulo e resumo são obrigatórios')
      const pend = Array.isArray(entrada.pendencias) ? (entrada.pendencias as Pendencia[]) : []
      const r = await registrarReuniao({ tipo, titulo, resumo, pauta: str(entrada.pauta) ?? null, pendencias: pend, origem: 'whatsapp' })
      return { id: r.id, tipo: r.tipo, titulo: r.titulo, pendencias: r.pendencias.length }
    }
    case 'concluir_pendencia': {
      const trecho = str(entrada.trecho)
      if (!trecho) throw new Error('trecho é obrigatório')
      const feitas = await concluirPendencia(trecho)
      return feitas.length ? feitas : { aviso: 'Nenhuma pendência aberta contém esse trecho.' }
    }
    case 'gravar_placar': {
      const p = await gravarPlacar('whatsapp', str(entrada.observacoes) ?? null)
      return { id: p.id, semana_inicio: p.semana_inicio, gerado_em: p.gerado_em }
    }
    default:
      throw new Error(`ferramenta desconhecida: ${nome}`)
  }
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

function promptSistema(): string {
  return `Você é o agente de gestão da Confeccione, marketplace B2B de confecção de roupas (Recife, PE) que conecta clientes a fornecedores. Está falando pelo WhatsApp com o Fernando, fundador da empresa. Agora em Recife: ${agoraRecife()}.

RITUAL (decisão D-7): duas reuniões por dia por esta conversa. 07:00 — fila do dia e as 3 prioridades. 17:30 — o que saiu, o que travou, decisões e ata. Fora desses horários ele também pode te chamar pra qualquer assunto da empresa. A reunião de segunda 07:00 é a do placar semanal (grave a foto com gravar_placar).

FONTE DE VERDADE: o diário de bordo, pelas ferramentas. Nunca invente número — se não consultou, consulte. Na primeira mensagem de uma reunião chame resumo_gestao. Se a sua última mensagem foi só o aviso de que a pauta está pronta, a primeira resposta é a pauta completa. Consulte buscar_decisoes antes de propor algo que pode já ter sido decidido.

O QUE VOCÊ PODE: ler placar, filas, decisões e atas; registrar decisão, ata, pendência concluída e foto do placar. O QUE VOCÊ NÃO PODE: mandar mensagem a cliente ou fornecedor, cobrar, mexer em pedido, gastar dinheiro. Se ele pedir algo assim, diga em uma linha o que faria e que a execução é dele ou do Cowork (Claude no computador), e registre como pendência.

REGISTRO: só grave decisão quando o Fernando decidir de forma explícita ("vamos fazer X", "decidido", "fica assim"); se houver dúvida, confirme em uma linha antes. No fim da reunião (ele diz "fechamos", "é isso", "pode registrar" ou pede a ata) grave a ata com registrar_reuniao (tipo manha ou tarde conforme a hora; sessao fora delas) com resumo curto e pendências com dono e prazo, e marque com concluir_pendencia o que ele disser que fez.

DECISÕES VIGENTES (detalhes em buscar_decisoes): D-1 WhatsApp só pela API oficial da Meta (Z-API desligada). D-2 sem SaaS de IA por cima do sistema: controle próprio, placar semanal, agentes por função com nível de autonomia. D-3 e-mail no motor próprio via Resend. D-4 MCP no lugar de iPaaS. D-5 memória de gestão no Supabase (placar, decisões, atas). D-6 mensagens de recuperação e cobrança no WhatsApp curtas, sem emoji, sem botão, pelo agente Luigi. D-7 esta reunião, 2x por dia.

ESTILO: WhatsApp. Curto — de 2 a 8 linhas na maior parte das vezes; a pauta pode ter até 12. Português direto, sem preâmbulo, sem elogio, sem emoji. Sem markdown: nada de #, tabelas ou **; no máximo *negrito* em um número importante e linhas começando com "-". Valores em reais no formato brasileiro (R$ 1.234,56). Uma pergunta por vez. Quando não souber, diga. Quando a resposta for uma lista de pessoas ou pedidos, traga nome, valor e há quanto tempo. Termine a pauta com a pergunta do que ele quer atacar primeiro.`
}

// ─── Histórico da conversa ──────────────────────────────────────────────────

type LinhaMensagem = { wamid: string | null; direcao: string; tipo: string; corpo: string | null; template_nome: string | null; criado_em: string }

function textoDaLinha(m: LinhaMensagem): string {
  if (m.corpo && m.corpo.trim()) return m.corpo.trim()
  switch (m.tipo) {
    case 'audio':
      return '[áudio]'
    case 'image':
      return '[imagem]'
    case 'document':
      return '[documento]'
    default:
      return `[${m.tipo}]`
  }
}

async function historicoConversa(conversaId: string): Promise<{ msgs: Anthropic.Messages.MessageParam[]; wamids: Set<string> }> {
  const { data } = await supabaseAdmin
    .from('wa_mensagens')
    .select('wamid, direcao, tipo, corpo, template_nome, criado_em')
    .eq('conversa_id', conversaId)
    .order('criado_em', { ascending: false })
    .limit(HISTORICO_MENSAGENS)

  const linhas = ((data ?? []) as LinhaMensagem[]).reverse()
  const wamids = new Set(linhas.map((m) => m.wamid).filter((w): w is string => Boolean(w)))
  const msgs: Anthropic.Messages.MessageParam[] = []
  for (const m of linhas) {
    const role: 'user' | 'assistant' = m.direcao === 'entrada' ? 'user' : 'assistant'
    const texto = textoDaLinha(m)
    const anterior = msgs[msgs.length - 1]
    if (anterior && anterior.role === role && typeof anterior.content === 'string') {
      anterior.content = `${anterior.content}\n\n${texto}`
    } else {
      msgs.push({ role, content: texto })
    }
  }
  // A API exige começar com o usuário; se a conversa abre com a pauta (nossa),
  // um marcador vazio no lugar dele preserva o contexto em vez de descartá-lo.
  if (msgs.length && msgs[0].role !== 'user') msgs.unshift({ role: 'user', content: '[início da conversa]' })
  return { msgs, wamids }
}

// ─── O loop do agente ───────────────────────────────────────────────────────

type ChamadaFerramenta = { nome: string; argumentos: Entrada; ok: boolean; erro?: string }

type ResultadoAgente = {
  texto: string
  ferramentas: ChamadaFerramenta[]
  rodadas: number
  tokensEntrada: number
  tokensSaida: number
}

function textoDaResposta(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()
}

async function rodarAgente(mensagens: Anthropic.Messages.MessageParam[], rota: string): Promise<ResultadoAgente> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY ausente')
  const client = new Anthropic({ apiKey })

  const historico: Anthropic.Messages.MessageParam[] = [...mensagens]
  const ferramentas: ChamadaFerramenta[] = []
  let tokensEntrada = 0
  let tokensSaida = 0
  let rodadas = 0
  let texto = ''

  while (rodadas < MAX_RODADAS) {
    rodadas++
    const resposta = await client.messages.create({
      model: MODELO,
      max_tokens: MAX_TOKENS_RESPOSTA,
      system: promptSistema(),
      tools: FERRAMENTAS,
      messages: historico,
    })
    void registrarUsoIa(rota, MODELO, resposta.usage)
    tokensEntrada += resposta.usage?.input_tokens ?? 0
    tokensSaida += resposta.usage?.output_tokens ?? 0

    const usos = resposta.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use')
    const parcial = textoDaResposta(resposta.content)
    if (parcial) texto = parcial

    if (resposta.stop_reason !== 'tool_use' || usos.length === 0) break

    historico.push({ role: 'assistant', content: resposta.content })
    const resultados: Anthropic.Messages.ToolResultBlockParam[] = []
    for (const uso of usos) {
      const entrada = (uso.input ?? {}) as Entrada
      try {
        const saida = await executarFerramenta(uso.name, entrada)
        ferramentas.push({ nome: uso.name, argumentos: entrada, ok: true })
        resultados.push({ type: 'tool_result', tool_use_id: uso.id, content: JSON.stringify(saida).slice(0, 60_000) })
      } catch (err) {
        const erro = err instanceof Error ? err.message : String(err)
        ferramentas.push({ nome: uso.name, argumentos: entrada, ok: false, erro })
        resultados.push({ type: 'tool_result', tool_use_id: uso.id, content: `Erro: ${erro}`, is_error: true })
      }
    }
    historico.push({ role: 'user', content: resultados })
  }

  if (!texto) texto = 'Não consegui fechar uma resposta agora. Pode repetir de outro jeito?'
  return { texto: paraWhatsApp(texto), ferramentas, rodadas, tokensEntrada, tokensSaida }
}

// ─── Log ────────────────────────────────────────────────────────────────────

type Log = {
  conversa_id: string | null
  wa_id: string
  wamid_entrada: string | null
  origem: 'resposta' | 'pauta'
  mensagem: string | null
  resposta: string | null
  ferramentas: ChamadaFerramenta[]
  modelo: string
  rodadas: number
  tokens_entrada: number
  tokens_saida: number
  duracao_ms: number
  enviado: boolean
  erro: string | null
}

async function gravarLog(l: Log): Promise<void> {
  try {
    await supabaseAdmin.from('gestao_whatsapp_log').insert(l)
  } catch (err) {
    console.error('[gestao-wa] log falhou', { err })
  }
}

// ─── Resposta a uma mensagem do gestor ──────────────────────────────────────

export async function responderGestao(params: {
  conversaId: string
  waId: string
  nome: string | null
  wamid: string
  /** criado_em gravado no inbox (timestamp da Meta, resolução de segundo). */
  criadoEm: string
  tipo: string
  corpo: string | null
}): Promise<void> {
  const inicio = Date.now()
  const waId = normalizarWaId(params.waId)
  if (!ehNumeroGestao(waId)) return

  const base: Omit<Log, 'resposta' | 'ferramentas' | 'rodadas' | 'tokens_entrada' | 'tokens_saida' | 'duracao_ms' | 'enviado' | 'erro'> = {
    conversa_id: params.conversaId,
    wa_id: waId,
    wamid_entrada: params.wamid,
    origem: 'resposta',
    mensagem: params.corpo,
    modelo: MODELO,
  }

  // Só texto por enquanto (áudio exigiria transcrição).
  const temTexto = Boolean(params.corpo && params.corpo.trim())
  if (!temTexto) {
    const aviso = 'Por enquanto só leio texto. Me manda escrito?'
    const r = await enviarTexto(waId, aviso)
    if (r.ok) await registrarSaidaInbox(waId, params.nome, r.wamid, aviso, null)
    await gravarLog({ ...base, resposta: aviso, ferramentas: [], rodadas: 0, tokens_entrada: 0, tokens_saida: 0, duracao_ms: Date.now() - inicio, enviado: r.ok, erro: r.ok ? null : r.erro })
    return
  }

  // Se ele mandou duas mensagens seguidas, quem responde é a última invocação
  // (o histórico dela já contém as duas). Evita resposta dupla. Só cede se a
  // outra é ESTRITAMENTE mais nova: com timestamp igual (mesmo segundo) as
  // duas responderiam, o que é melhor do que nenhuma responder.
  await dormir(2500)
  const { data: ultimaEntrada } = await supabaseAdmin
    .from('wa_mensagens')
    .select('wamid, criado_em')
    .eq('conversa_id', params.conversaId)
    .eq('direcao', 'entrada')
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (
    ultimaEntrada?.wamid &&
    ultimaEntrada.wamid !== params.wamid &&
    new Date(ultimaEntrada.criado_em).getTime() > new Date(params.criadoEm).getTime()
  ) {
    return
  }

  void marcarComoLida(params.wamid).catch(() => false)

  try {
    const historico = await historicoConversa(params.conversaId)
    let mensagens = historico.msgs
    // Garante que a mensagem que disparou esta resposta está no fim do
    // histórico (se a leitura não a viu, ou se o último turno não é dele).
    const ultima = mensagens[mensagens.length - 1]
    if (!historico.wamids.has(params.wamid) || !ultima || ultima.role !== 'user') {
      const atual = (params.corpo ?? '').trim()
      if (ultima && ultima.role === 'user' && typeof ultima.content === 'string') {
        mensagens = [...mensagens.slice(0, -1), { role: 'user', content: `${ultima.content}\n\n${atual}` }]
      } else {
        mensagens = [...mensagens, { role: 'user', content: atual }]
      }
    }

    const r = await rodarAgente(mensagens, 'gestao-whatsapp')

    let enviado = false
    let erroEnvio: string | null = null
    for (const parte of partirTexto(r.texto)) {
      const envio = await enviarTexto(waId, parte)
      if (!envio.ok) {
        erroEnvio = envio.erro
        break
      }
      enviado = true
      await registrarSaidaInbox(waId, params.nome, envio.wamid, parte, null)
    }

    await gravarLog({
      ...base,
      resposta: r.texto,
      ferramentas: r.ferramentas,
      rodadas: r.rodadas,
      tokens_entrada: r.tokensEntrada,
      tokens_saida: r.tokensSaida,
      duracao_ms: Date.now() - inicio,
      enviado,
      erro: erroEnvio,
    })
  } catch (err) {
    const erro = err instanceof Error ? err.message : String(err)
    console.error('[gestao-wa] responderGestao falhou', { erro })
    const aviso = 'Não consegui responder agora (erro interno). Tenta de novo em um minuto.'
    const r = await enviarTexto(waId, aviso)
    if (r.ok) await registrarSaidaInbox(waId, params.nome, r.wamid, aviso, null)
    await gravarLog({ ...base, resposta: null, ferramentas: [], rodadas: 0, tokens_entrada: 0, tokens_saida: 0, duracao_ms: Date.now() - inicio, enviado: false, erro })
  }
}

// ─── Pauta das 07:00 e das 17:30 (cron) ─────────────────────────────────────

export type ResultadoPauta = {
  tipo: TipoReuniaoDiaria
  destinos: Array<{ wa_id: string; ok: boolean; template: string | null; erro?: string }>
  pauta: string
}

/** Pauta de reserva quando a API do Claude falha: só os números, sem juízo. */
function pautaDeReserva(tipo: TipoReuniaoDiaria, d: Awaited<ReturnType<typeof dadosDaPauta>>): string {
  const agora = d.resumo.placar.agora
  const linhas = [
    tipo === 'manha' ? 'Bom dia, Fernando. Pauta das 07:00:' : 'Boa tarde, Fernando. Pauta das 17:30:',
    `- ${d.cobranca.length} aguardando pagamento (${reais(d.cobranca.reduce((a, i) => a + i.valor_centavos, 0))})`,
    `- ${d.semResposta.length} conversas sem resposta há mais de 2 h`,
    `- ${d.semFornecedor.length} pedidos confirmados sem fornecedor há mais de 24 h`,
    `- ${d.resumo.pendencias_abertas.length} pendências abertas nas últimas atas`,
  ]
  if (typeof agora?.wa_nao_lidas === 'number') linhas.push(`- ${agora.wa_nao_lidas} mensagens não lidas no inbox`)
  linhas.push('Por onde começamos?')
  return linhas.join('\n')
}

async function dadosDaPauta() {
  const [resumo, cobranca, semResposta, semFornecedor] = await Promise.all([
    resumoGestao(),
    filaCobranca(),
    conversasSemResposta(2),
    pedidosSemFornecedor(24),
  ])
  return { resumo, cobranca, semResposta, semFornecedor }
}

function resumoEmUmaLinha(d: Awaited<ReturnType<typeof dadosDaPauta>>): string {
  const total = d.cobranca.reduce((a, i) => a + i.valor_centavos, 0)
  return (
    `${d.cobranca.length} aguardando pagamento (${reais(total)}), ` +
    `${d.semResposta.length} conversas sem resposta, ` +
    `${d.semFornecedor.length} pedidos sem fornecedor, ` +
    `${d.resumo.pendencias_abertas.length} pendências abertas`
  )
}

export async function enviarPauta(tipo: TipoReuniaoDiaria): Promise<ResultadoPauta> {
  const inicio = Date.now()
  const hora = tipo === 'manha' ? '07:00' : '17:30'
  const destinos = numerosGestao()
  const dados = await dadosDaPauta()

  // Pra ficar leve no prompt: listas cortadas e sem campos que não mudam a pauta.
  const compacto = {
    agora_recife: agoraRecife(),
    placar_agora: dados.resumo.placar.agora,
    placar_7d: dados.resumo.placar.d7,
    placar_30d: dados.resumo.placar.d30,
    cobranca: dados.cobranca.slice(0, 15).map((i) => ({ cliente: i.cliente, valor: reais(i.valor_centavos), dias: i.dias_em_aberto, fonte: i.fonte })),
    sem_resposta: dados.semResposta.slice(0, 10).map((c) => ({ contato: c.contato, vinculo: c.vinculo, horas: c.horas_esperando, preview: c.preview })),
    sem_fornecedor: dados.semFornecedor.slice(0, 10).map((p) => ({ cliente: p.cliente, uf: p.uf, resumo: p.resumo, horas: p.horas_esperando, ofertas_no_ar: p.ofertas_no_ar, recusadas: p.ofertas_recusadas })),
    pendencias_abertas: dados.resumo.pendencias_abertas.slice(0, 15),
    decisoes_para_revisar: dados.resumo.decisoes_para_revisar.map((d) => `D-${d.numero} ${d.titulo}`),
    ultimas_reunioes: dados.resumo.ultimas_reunioes.slice(0, 4),
  }

  const pedido =
    tipo === 'manha'
      ? 'Monte a pauta da reunião das 07:00: cumprimente em uma linha, traga a fila do dia (cobrança, sem resposta, sem fornecedor) com nomes, valores e tempo, as pendências que vencem hoje e proponha as 3 prioridades do dia. Feche perguntando por onde ele quer começar.'
      : 'Monte a pauta da reunião das 17:30: cumprimente em uma linha, diga o que mudou desde a manhã (pagamentos, respostas, ofertas aceitas) se der pra ver nos números, o que segue travado, as pendências em aberto e pergunte o que foi feito hoje e o que decidir antes de fechar o dia.'

  let pauta: string
  let ferramentas: ChamadaFerramenta[] = []
  let rodadas = 0
  let tokensEntrada = 0
  let tokensSaida = 0
  let erro: string | null = null
  try {
    const r = await rodarAgente(
      [{ role: 'user', content: `${pedido}\n\nDados do diário de bordo (já consultados, não precisa chamar resumo_gestao):\n${JSON.stringify(compacto)}` }],
      'gestao-whatsapp-pauta'
    )
    pauta = r.texto
    ferramentas = r.ferramentas
    rodadas = r.rodadas
    tokensEntrada = r.tokensEntrada
    tokensSaida = r.tokensSaida
  } catch (err) {
    erro = err instanceof Error ? err.message : String(err)
    console.error('[gestao-wa] pauta pelo Claude falhou, usando reserva', { erro })
    pauta = pautaDeReserva(tipo, dados)
  }

  const resumo = resumoEmUmaLinha(dados)
  const resultado: ResultadoPauta = { tipo, destinos: [], pauta }
  for (const waId of destinos) {
    const envio = await enviarParaGestor(waId, pauta, { hora, resumo })
    resultado.destinos.push(envio.ok ? { wa_id: waId, ok: true, template: envio.template } : { wa_id: waId, ok: false, template: null, erro: envio.erro })
    await gravarLog({
      conversa_id: null,
      wa_id: waId,
      wamid_entrada: null,
      origem: 'pauta',
      mensagem: `pauta ${tipo}`,
      resposta: pauta,
      ferramentas,
      modelo: MODELO,
      rodadas,
      tokens_entrada: tokensEntrada,
      tokens_saida: tokensSaida,
      duracao_ms: Date.now() - inicio,
      enviado: envio.ok,
      erro: envio.ok ? erro : `${erro ? erro + ' | ' : ''}${envio.erro}`,
    })
  }
  if (destinos.length === 0) console.warn('[gestao-wa] WHATSAPP_GESTAO_NUMEROS vazio — pauta não enviada')
  return resultado
}
