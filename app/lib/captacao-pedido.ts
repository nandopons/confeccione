// app/lib/captacao-pedido.ts
// ============================================================================
// CAPTAÇÃO PUXADA PELO PEDIDO — o agente que sai atrás de confecção quando
// um pedido fica sem fornecedor (08/09/2026).
//
// Pedido confirmado há mais de 24 h sem aceite (etapa sem_fornecedor, D-8)
// vira uma BUSCA: o Claude pesquisa na web (Google, perfis do Instagram
// indexados e, se houver chave, o Google Places) confecções, facções e
// ateliês que produzam aquele tipo de peça naquela quantidade, extrai nome,
// cidade, WhatsApp, Instagram, site e e-mail, e o sistema manda uma sondagem
// pontual — "vocês fazem X em lote de N?" — por e-mail (com o resumo do
// pedido em PDF, sem nome nem contato do cliente) e por WhatsApp (template
// aprovado; até aprovar, só e-mail). Quem responde cai no inbox e é atendido
// pelo Luigi em modo captação: "sim" → PDF, cadastro e aviso ao Fernando;
// "não" → registra e agradece.
//
// Decisões do Fernando (08/09): aborda sozinho com teto — 10 confecções por
// pedido, 40 mensagens frias por dia; busca primeiro no estado do cliente,
// depois no polo de Pernambuco, depois no Brasil; o PDF esconde nome e
// contato do cliente. Tudo fica em captacao_fornecedores (origem 'pedido')
// e captacao_buscas; o modo e os tetos em agentes_config ('captacao').
//
// Nunca raspa o Instagram: o que se lê são páginas indexadas pelo buscador.
// Cada candidato é abordado uma vez por número/e-mail; quem já é fornecedor
// cadastrado, já está na captação ou pediu pra não receber fica de fora.
// ============================================================================

import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from './supabase-server'
import { salvarFotoDaConversa } from './portfolio-fornecedor'
import { salvarPerfil } from './perfil-producao'
import { registrarUsoIa } from './uso-ia'
import { pecaDaLinha } from './pecas'
import { normalizarWhatsApp } from './phone'
import { pedidosPorEtapa, pedidoEtapa, type PedidoEtapa } from './etapas-pedido'
import { normalizarWaId, enviarTemplate, enviarTexto, enviarMidiaPorId, uploadMidia, marcarComoLida, listarTemplates } from './whatsapp-cloud'
import { consultarTemplatesWhatsApp } from './whatsapp-templates'
import { janela24hAberta, registrarSaidaInbox, vincularContato } from './whatsapp-notify'
import { emailSondagemProducao } from './email'
import { gerarResumoPedidoPdf, type ResumoPedido } from './resumo-pdf'
import { URL_CADASTRO_FORNECEDOR } from './captacao-templates'
import { estaEmHorarioComercial } from './horario'
import { avisarGestor, marcarEscalada } from './luigi'
import { ehModoLuigi, type ModoLuigi } from './luigi-catalogo'

const MODELO = 'claude-sonnet-4-6'
const MAX_RODADAS_BUSCA = 8
const MAX_BUSCAS_WEB = 10
const MAX_TOKENS_BUSCA = 4000
const MAX_RODADAS_RESPOSTA = 4
const MAX_TOKENS_RESPOSTA = 500
const PEDIDOS_POR_RODADA = 4
const HISTORICO_MENSAGENS = 20

/**
 * Template da sondagem fria (a abertura curta: "Oi, {{1}}, tudo bem? Aqui é o
 * Luigi, da Confeccione. Gostaria de tirar uma dúvida sobre uma produção com
 * vocês."). Submetido à Meta em 08/09/2026 como `sondagem_producao`; a env só
 * serve pra trocar de nome sem deploy.
 */
export const TEMPLATE_SONDAGEM = process.env.WHATSAPP_TEMPLATE_SONDAGEM || 'sondagem_producao'


/**
 * AS FALAS DO CADASTRO POR CONVERSA — 12/09/2026.
 *
 * Constante e não prompt porque cada uma delas foi escrita contra um erro que
 * já aconteceu na conversa da Bordado Mágico (10/09), e o modelo parafraseando
 * desfaz a correção:
 *
 *   PRODUTOS   — DOIS GALHOS. Se ela FAZ a peça do pedido, a pergunta parte do
 *                que ela acabou de dizer; se NÃO faz, vira aberta e a conversa
 *                segue pro MESMO cadastro. Sem lista sugerida em nenhum dos
 *                dois: existe todo tipo de fornecedor e a lista induz. Ela
 *                responde em texto livre — quem traduz pro catálogo é
 *                `pecaDaLinha`, no código, nunca o modelo.
 *   LICENCA    — sem "em vez de preencher site". Chamar atenção pro atrito que
 *                ela nem tinha pensado é criar o atrito.
 *   MINIMO_ANCORA — "depende" não grava (a ferramenta recusa). A âncora é o que
 *                transforma "depende" em número.
 *   CONFIRMACAO — o formulário mostra o que ela preencheu antes de enviar; na
 *                conversa isso só existe se for dito. Sem prazo: prazo varia de
 *                negociação pra negociação, e aqui viraria chute. Ele volta no
 *                ORÇAMENTO, onde é número assumido.
 *   PRONTO     — dois também. Nascendo aprovada ela entra no matching na hora,
 *                e essa é a prova de valor que o formulário nunca deu. Mas o
 *                fecho do galho (b) NÃO fala da região nem sugere que o pedido
 *                de agora vai: ela disse que não faz essa peça. Nenhum dos dois
 *                promete volume — são 4 pedidos entregues em 229.
 *
 * O modelo preenche o que está entre {chaves}.
 */
export const FALAS_CADASTRO = {
  /** Galho (a): ela FAZ a peça do pedido. Parte do que ela acabou de dizer —
   *  perguntar "que tipo de produto vocês fazem" depois de ela confirmar a peça
   *  é repetir a pergunta anterior. `{peça}` é a peça do pedido. */
  produtosFaz: 'Além de {peça}, quais os principais produtos que vocês fazem? Pode ser 3.',
  /** Galho (b): ela NÃO faz. Um "não" pra esta peça não é um "não" pra
   *  plataforma — a conversa não acaba, muda de assunto. Aberta, sem âncora,
   *  porque não há peça confirmada pra partir. */
  produtosNaoFaz: 'Sem problema. E o que vocês fazem? Pode ser 3 — assim eu te mando o que combinar com vocês.',
  licenca: 'Posso te perguntar três coisas rápidas aqui mesmo?',
  porque: 'É pra eu te mandar só pedido que combina com vocês, em vez de tudo.',
  cidade: 'Vocês são de que cidade?',
  minimo: 'Qual o pedido mínimo de vocês?',
  minimoAncora: 'Me dá um número: abaixo de quanto não compensa ligar a máquina?',
  confirmacao: 'Então: vocês fazem {peças}, em {cidade}/{UF}, mínimo {N} peças. Confere?',
  /** Fecho do galho (a): ela faz a peça, então o pedido da região dela vale. */
  prontoFaz:
    'Pronto, já está valendo. Assim que entrar pedido da sua região que combine com o que vocês fazem, você recebe aqui.',
  /** Fecho do galho (b): NÃO pode sugerir que ESTE pedido vai — ela disse que
   *  não faz esta peça. Fica no genérico. */
  prontoNaoFaz: 'Pronto, já está valendo. Assim que entrar pedido que combine com vocês, você recebe aqui.',
} as const

/**
 * A COMISSÃO, COM O NÚMERO. TEXTO FIXO, PELO MESMO MOTIVO DA GARANTIA.
 *
 * Estava solta no bloco "COMO FUNCIONA" e o modelo parafraseava — "uma comissão
 * sobre o valor fechado", sem número. Dizer a garantia com precisão e o preço
 * com vaguidão é assimetria que a pessoa sente sem saber nomear, e é a que faz
 * ela desconfiar depois, quando descobre o número sozinha.
 *
 * O 3% vem de COMISSAO_PCT (pedido-assistente-oferta.ts). Se mudar lá, muda
 * aqui — e é de propósito que a frase seja literal em vez de interpolada: o
 * número que a confecção ouve não pode variar por acidente de import.
 */

export const TEXTO_COMISSAO =
  'Como funciona: a Confeccione te manda os pedidos que combinam com o que vocês fazem, vocês dizem o preço e o prazo, ' +
  'e o cliente decide. A Confeccione fica com uma comissão de 3% sobre o valor fechado, só quando o pedido fecha.'

/**
 * O PAGAMENTO, DITO DO LADO DELA — 12/09/2026. TEXTO FIXO, NÃO PROMPT.
 *
 * O Luigi dizia: "o cliente paga à Confeccione e a gente repassa depois da
 * entrega. Ninguém manda pix pra ninguém fora da plataforma." Mesmo fato, dono
 * da frase errado: descreve o mecanismo do ponto de vista da plataforma e
 * termina numa proibição. Pra quem ouve, soa "eles seguram meu dinheiro".
 *
 * A Bordado Mágico pediu pix na primeira conversa ("manda o pedido e te passo o
 * pix") e recebeu exatamente essa frase. Não voltou.
 *
 * Invertido: quem costura pra terceiro tem um medo só, e é calote. O mesmo
 * mecanismo, contado como garantia contra ele. É TEXTO FIXO porque o agente
 * parafraseia e perde a inversão justamente na hora em que ela importa — foi o
 * que aconteceu em 10/09.
 */
export const TEXTO_PAGAMENTO_GARANTIA =
  'Sobre o pagamento: o cliente paga antes, e o dinheiro fica na Confeccione até você entregar. ' +
  'Na prática você não corre risco de produzir e não receber, porque quando você começa a produzir o valor já está garantido.'
const IDIOMA_TEMPLATE_SONDAGEM = 'pt_BR'

export type StatusTemplateSondagem = {
  nome: string
  /** APPROVED | PENDING | REJECTED | … da Meta; 'inexistente' se a WABA não tem esse nome; null se a consulta falhou. */
  status: string | null
  categoria: string | null
  motivo_rejeicao: string | null
  erro: string | null
}

let cacheAprovado: { ok: boolean; em: number } | null = null
const CACHE_APROVACAO_MS = 15 * 60 * 1000

/**
 * O WhatsApp da sondagem só sai com o template APROVADO na Meta — mandar um
 * pendente devolve erro e suja a linha do candidato. Em vez de env + redeploy
 * no dia da aprovação, a lib pergunta à WABA (lista de aprovados): a rodada
 * seguinte à aprovação já manda. Só o "sim" fica em cache (15 min por
 * instância); enquanto está pendente, cada abordagem com WhatsApp faz uma
 * consulta — são poucas por dia e é isso que percebe a aprovação na hora.
 */
export async function templateSondagemAprovado(): Promise<boolean> {
  if (cacheAprovado?.ok && Date.now() - cacheAprovado.em < CACHE_APROVACAO_MS) return true
  const aprovados = await listarTemplates()
  const ok = aprovados.some((t) => t.name === TEMPLATE_SONDAGEM && t.language === IDIOMA_TEMPLATE_SONDAGEM)
  if (ok) cacheAprovado = { ok, em: Date.now() }
  return ok
}

/** Situação do template na Meta, pro painel dizer se a sondagem sai também por WhatsApp. */
export async function statusTemplateSondagem(): Promise<StatusTemplateSondagem> {
  const r = await consultarTemplatesWhatsApp([TEMPLATE_SONDAGEM])
  if (!r.ok) return { nome: TEMPLATE_SONDAGEM, status: null, categoria: null, motivo_rejeicao: null, erro: r.erro ?? 'consulta falhou' }
  const t = r.templates.find((x) => x.language === IDIOMA_TEMPLATE_SONDAGEM) ?? r.templates[0]
  if (!t) return { nome: TEMPLATE_SONDAGEM, status: 'inexistente', categoria: null, motivo_rejeicao: null, erro: null }
  const rejeicao = t.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : null
  return { nome: TEMPLATE_SONDAGEM, status: t.status, categoria: t.category || null, motivo_rejeicao: rejeicao, erro: null }
}

// ─── Configuração (agentes_config, linha 'captacao') ────────────────────────

export type RegiaoBusca = 'uf' | 'pe' | 'brasil'
export const REGIOES: RegiaoBusca[] = ['uf', 'pe', 'brasil']
export const REGIAO_LABEL: Record<RegiaoBusca, string> = { uf: 'estado do cliente', pe: 'polo de Pernambuco', brasil: 'Brasil' }

export type ConfigCaptacao = {
  /**
   * Quantas confecções uma ONDA aborda de uma vez, por pedido. É o número que
   * o Fernando pediu em 10/09/2026: "seleciona uns 2, manda mensagem e e-mail,
   * espera um pouco pra ver a resposta; se não der certo busca mais 2".
   *
   * Antes disto a primeira busca abordava a cota inteira (10 de uma vez). Dava
   * na mesma conta de mensagens fria no fim do mês, só que toda no primeiro
   * minuto: se a segunda confecção já ia topar, as outras oito foram incômodo
   * puro — e token de busca gasto à toa.
   */
  lote: number
  /** Teto de confecções abordadas por pedido, somando todas as ondas. */
  max_por_pedido: number
  max_por_dia: number
  regioes: RegiaoBusca[]
  /** Quanto a onda espera resposta antes da próxima sair. */
  horas_entre_buscas: number
  /** Pedido sem fornecedor há mais que isso (dias) o cron não busca sozinho — só pelo "Buscar agora". */
  idade_max_dias: number
}

const CONFIG_PADRAO: ConfigCaptacao = { lote: 2, max_por_pedido: 10, max_por_dia: 40, regioes: REGIOES, horas_entre_buscas: 24, idade_max_dias: 21 }

function num(v: unknown, padrao: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : padrao
  return Math.min(Math.max(Math.round(n), min), max)
}

export async function configCaptacao(): Promise<{ modo: ModoLuigi; config: ConfigCaptacao }> {
  const { data, error } = await supabaseAdmin
    .from('agentes_config')
    .select('modo, config')
    .eq('agente', 'captacao')
    .maybeSingle<{ modo: string; config: Record<string, unknown> | null }>()
  // "NÃO SEI" NÃO É "DESLIGADO" — 11/09/2026. Sem `error`, uma consulta que
  // falhasse devolvia data nulo e caía no mesmo galho do "sem linha":
  // 'desligado'. A captação parava inteira e o painel dizia que estava
  // desligada, como se alguém tivesse desligado. Sem linha segue desligado;
  // consulta que falha estoura.
  if (error) throw new Error(`config da captação: ${error.message}`)
  const c = data?.config ?? {}
  const regioes = Array.isArray(c.regioes) ? (c.regioes as unknown[]).filter((r): r is RegiaoBusca => REGIOES.includes(r as RegiaoBusca)) : REGIOES
  return {
    modo: ehModoLuigi(data?.modo) ? data.modo : 'desligado',
    config: {
      lote: num(c.lote, CONFIG_PADRAO.lote, 1, 10),
      max_por_pedido: num(c.max_por_pedido, CONFIG_PADRAO.max_por_pedido, 1, 50),
      max_por_dia: num(c.max_por_dia, CONFIG_PADRAO.max_por_dia, 1, 200),
      regioes: regioes.length ? regioes : REGIOES,
      horas_entre_buscas: num(c.horas_entre_buscas, CONFIG_PADRAO.horas_entre_buscas, 1, 720),
      idade_max_dias: num(c.idade_max_dias, CONFIG_PADRAO.idade_max_dias, 1, 365),
    },
  }
}

export async function definirConfigCaptacao(patch: { modo?: ModoLuigi } & Partial<ConfigCaptacao>): Promise<void> {
  const atual = await configCaptacao()
  const config: ConfigCaptacao = {
    lote: num(patch.lote, atual.config.lote, 1, 10),
    max_por_pedido: num(patch.max_por_pedido, atual.config.max_por_pedido, 1, 50),
    max_por_dia: num(patch.max_por_dia, atual.config.max_por_dia, 1, 200),
    regioes: patch.regioes?.length ? patch.regioes.filter((r) => REGIOES.includes(r)) : atual.config.regioes,
    horas_entre_buscas: num(patch.horas_entre_buscas, atual.config.horas_entre_buscas, 1, 720),
    idade_max_dias: num(patch.idade_max_dias, atual.config.idade_max_dias, 1, 365),
  }
  const { error } = await supabaseAdmin
    .from('agentes_config')
    .upsert({ agente: 'captacao', modo: patch.modo ?? atual.modo, config, atualizado_em: new Date().toISOString() }, { onConflict: 'agente' })
  if (error) throw new Error(`config da captação: ${error.message}`)
}

// ─── Perfil de busca: o que o pedido pede ───────────────────────────────────

type LinhaPedido = {
  modelo?: string | null
  cor?: string | null
  material?: string | null
  total?: number | null
  publico?: string | null
  tamanhos?: Array<{ tamanho?: string | null; qtd?: number | null }> | null
  estampas?: Array<{ posicao?: string | null; tamanho?: string | null }> | null
  acabamentos?: string[] | null
  descricao?: string | null
}

export type PerfilBusca = {
  pedidoId: string
  codigo: string | null
  /** "50 camisetas em algodão com estampa frontal" — como aparece na mensagem. */
  descricao: string
  modelos: string[]
  materiais: string[]
  tecnicas: string[]
  quantidade: number
  cidade: string | null
  uf: string | null
  prazoDias: number | null
  segmento: string
}

function limpo(s: string | null | undefined): string {
  return (s ?? '').replace(/\s*\(#?[0-9a-fA-F]{6}\)\s*/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

function unico(xs: string[]): string[] {
  return [...new Set(xs.map((x) => x.trim().toLowerCase()).filter(Boolean))]
}

/** Segmento da captação (ids de captacao-templates) a partir das peças. */
export function segmentoDasPecas(modelos: string[]): string {
  const t = modelos.join(' ').toLowerCase()
  const regras: Array<[RegExp, string]> = [
    [/legging|top fitness|fitness|academia|short de treino|regata dry/, 'fitness'],
    [/biqu[ií]ni|mai[oô]|sunga|sa[ií]da de praia|praia/, 'moda_praia'],
    [/lingerie|calcinha|cueca|pijama|sutiã|suti[aã]|[íi]ntima/, 'moda_intima'],
    [/farda|uniforme escolar|jaleco|corporativ|fardamento/, 'fardamento'],
    [/time|esportiv|futebol|goleiro|jersey/, 'padrao_esportivo'],
    [/\buv\b|prote[çc][ãa]o solar/, 'roupas_uv'],
    [/bolsa|mochila|ecobag|necessaire/, 'bolsas'],
    [/bon[eé]|viseira/, 'bones'],
    [/turma|interclasse|formatura|evento|abadá|abada/, 'interclasse'],
  ]
  for (const [re, seg] of regras) if (re.test(t)) return seg
  return 'private_label'
}

export function perfilDeBusca(p: PedidoEtapa, prazoDias: number | null): PerfilBusca {
  const linhas = (Array.isArray(p.linhas) ? p.linhas : []) as LinhaPedido[]
  const modelos = unico(linhas.map((l) => limpo(l.modelo)))
  const materiais = unico(linhas.map((l) => limpo(l.material)))
  const tecnicas = unico(
    linhas.flatMap((l) => [
      ...((l.estampas?.length ?? 0) > 0 ? ['estampa'] : []),
      ...(l.acabamentos ?? []).map((a) => limpo(a)),
    ])
  )
  const quantidade = linhas.reduce((s, l) => s + (typeof l.total === 'number' ? l.total : (l.tamanhos ?? []).reduce((a, t) => a + (t.qtd ?? 0), 0)), 0)
  const pecas = modelos.length ? modelos.join(', ') : p.categoria ?? 'peças de vestuário'
  const material = materiais.length ? ` em ${materiais.join('/')}` : ''
  const tecnica = tecnicas.includes('estampa') ? ' com estampa' : ''
  const descricao = `${quantidade || '?'} ${pecas}${material}${tecnica}`
  return {
    pedidoId: p.id,
    codigo: p.codigo,
    descricao,
    modelos: modelos.length ? modelos : [p.categoria ?? 'roupa'],
    materiais,
    tecnicas,
    quantidade,
    cidade: p.cidade,
    uf: p.uf,
    prazoDias,
    segmento: segmentoDasPecas(modelos.length ? modelos : [p.categoria ?? '']),
  }
}

// ─── Candidatos ─────────────────────────────────────────────────────────────

export type Candidato = {
  nome: string
  cidade: string | null
  uf: string | null
  whatsapp: string | null
  telefone: string | null
  email: string | null
  instagram: string | null
  site: string | null
  fonte: string | null
  evidencia: string | null
  confianca: 'alta' | 'media' | 'baixa'
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/**
 * O NÚMERO DA CONFECÇÃO, EM E.164 — 12/09/2026.
 *
 * UMA FUNÇÃO SÓ, e isso é o ponto. Antes eram duas regras contraditórias sobre
 * o mesmo dado: esta separava fixo (mandava pra coluna `telefone`, deixava
 * `whatsapp` nulo, de propósito) e a gravação em `abordarCandidato` desfazia com
 * `c.whatsapp ?? c.telefone`, escrevendo o fixo cru na coluna `whatsapp`. A de
 * baixo venceu, e 12 leads (30% dos que tinham número) ficaram com 10 dígitos e
 * sem o 55 — a Meta recusa, a sondagem nunca saiu, e template recusado derruba o
 * quality rating da WABA.
 *
 * É a mesma lição do selo FORNECEDOR de doze horas antes: duas funções contando
 * histórias diferentes sobre o mesmo fato é pior que as duas erradas do mesmo
 * jeito, porque some a chance de alguém perceber.
 *
 * E A PREMISSA ANTIGA ERA FALSA. "Fixo não tem WhatsApp" foi desmentido pelo
 * 8132247097 — fixo de 10 dígitos que FOI ENTREGUE quando saiu com o 55. Fixo
 * comercial tem WhatsApp Business. Não se filtra fixo; normaliza-se.
 *
 * O nono dígito continua entrando quando o número é celular no formato antigo
 * (DDD + 8 dígitos começando em 6–9), que é site desatualizado. Fixo começa em
 * 2–5, então não há ambiguidade.
 */
function telefoneParaWaId(v: string | null): { whatsapp: string | null; telefone: string | null } {
  if (!v) return { whatsapp: null, telefone: null }
  const dig = v.replace(/\D/g, '').replace(/^0+/, '')
  if (dig.length < 10) return { whatsapp: null, telefone: null }
  const nacional = dig.startsWith('55') && dig.length >= 12 ? dig.slice(2) : dig
  // Celular no formato antigo: entra o nono dígito antes de normalizar.
  const comNove =
    nacional.length === 10 && /[6-9]/.test(nacional[2])
      ? `${nacional.slice(0, 2)}9${nacional.slice(2)}`
      : nacional
  if (comNove.length !== 10 && comNove.length !== 11) return { whatsapp: null, telefone: null }
  // `normalizarWaId` é a MESMA função que o resto do sistema usa pra falar com a
  // Meta. O critério dela é COMPRIMENTO, nunca prefixo — e isso importa:
  // 5591342110 é Caxias do Sul (DDD 55, 10 dígitos), e uma regra do tipo "se não
  // começa com 55, prefixa" deixaria essa linha quebrada pra sempre.
  return { whatsapp: normalizarWaId(comNove), telefone: null }
}

function emailValido(v: string | null): string | null {
  if (!v) return null
  const e = v.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : null
}

function instagramHandle(v: string | null): string | null {
  if (!v) return null
  const m = v.trim().match(/(?:instagram\.com\/)?@?([a-z0-9._]{2,40})\/?$/i)
  return m ? m[1].toLowerCase() : null
}

function normalizarCandidato(raw: Record<string, unknown>): Candidato | null {
  const nome = str(raw.nome)
  if (!nome) return null
  const tel = telefoneParaWaId(str(raw.whatsapp) ?? str(raw.telefone))
  const tel2 = str(raw.whatsapp) && str(raw.telefone) ? telefoneParaWaId(str(raw.telefone)) : { whatsapp: null, telefone: null }
  const email = emailValido(str(raw.email))
  const whatsapp = tel.whatsapp ?? tel2.whatsapp
  const telefone = tel.telefone ?? tel2.telefone
  if (!whatsapp && !email && !telefone) return null
  const conf = str(raw.confianca)
  return {
    nome: nome.slice(0, 120),
    cidade: str(raw.cidade)?.slice(0, 80) ?? null,
    uf: str(raw.uf)?.toUpperCase().slice(0, 2) ?? null,
    whatsapp,
    telefone,
    email,
    instagram: instagramHandle(str(raw.instagram)),
    site: str(raw.site)?.slice(0, 200) ?? null,
    fonte: str(raw.fonte)?.slice(0, 300) ?? null,
    evidencia: str(raw.evidencia)?.slice(0, 300) ?? null,
    confianca: conf === 'alta' || conf === 'baixa' ? conf : 'media',
  }
}

// ─── Google Places (opcional) ───────────────────────────────────────────────

type LugarGoogle = { nome: string; endereco: string | null; telefone: string | null; site: string | null; maps: string | null; tipos: string[] }

export async function buscarGooglePlaces(consulta: string): Promise<LugarGoogle[] | { erro: string }> {
  const chave = process.env.GOOGLE_PLACES_API_KEY
  if (!chave) return { erro: 'GOOGLE_PLACES_API_KEY ausente' }
  try {
    const resp = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': chave,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.googleMapsUri,places.types,places.businessStatus',
      },
      body: JSON.stringify({ textQuery: consulta, languageCode: 'pt-BR', regionCode: 'BR', maxResultCount: 10 }),
    })
    if (!resp.ok) return { erro: `Places ${resp.status}: ${(await resp.text()).slice(0, 200)}` }
    const json = (await resp.json()) as { places?: Array<Record<string, unknown>> }
    return (json.places ?? [])
      .filter((p) => (p.businessStatus ?? 'OPERATIONAL') === 'OPERATIONAL')
      .map((p) => ({
        nome: String((p.displayName as { text?: string } | undefined)?.text ?? ''),
        endereco: str(p.formattedAddress),
        telefone: str(p.nationalPhoneNumber) ?? str(p.internationalPhoneNumber),
        site: str(p.websiteUri),
        maps: str(p.googleMapsUri),
        tipos: Array.isArray(p.types) ? (p.types as string[]).slice(0, 5) : [],
      }))
      .filter((p) => p.nome)
  } catch (err) {
    return { erro: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Descoberta: o Claude pesquisa ──────────────────────────────────────────

const POLO_PE = 'Recife, Caruaru, Toritama, Santa Cruz do Capibaribe, Surubim, Jaboatão dos Guararapes e Paulista (PE)'

function descricaoDaRegiao(perfil: PerfilBusca, regiao: RegiaoBusca): string {
  if (regiao === 'uf' && perfil.uf) return `no estado ${perfil.uf}${perfil.cidade ? `, começando por ${perfil.cidade} e cidades vizinhas` : ''}`
  if (regiao === 'pe' || (regiao === 'uf' && !perfil.uf)) return `no polo de confecção de Pernambuco: ${POLO_PE}`
  return 'em qualquer estado do Brasil, priorizando polos de confecção (Pernambuco, Santa Catarina, Ceará, Goiás, Minas Gerais, São Paulo)'
}

const FERRAMENTA_REGISTRAR: Anthropic.Messages.Tool = {
  name: 'registrar_candidatos',
  description: 'Entrega a lista final de confecções candidatas. Chame UMA vez, no fim, com tudo que encontrou. Lista vazia é válida.',
  input_schema: {
    type: 'object',
    properties: {
      candidatos: {
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          properties: {
            nome: { type: 'string' },
            cidade: { type: 'string' },
            uf: { type: 'string', description: 'Sigla, ex.: PE' },
            whatsapp: { type: 'string', description: 'Só dígitos, com DDD. Só se for celular/WhatsApp.' },
            telefone: { type: 'string', description: 'Fixo, só dígitos com DDD.' },
            email: { type: 'string' },
            instagram: { type: 'string', description: 'Só o @ ou o usuário.' },
            site: { type: 'string' },
            fonte: { type: 'string', description: 'URL onde achou o contato.' },
            evidencia: { type: 'string', description: 'Uma frase: por que ela produz esse pedido (o que a página diz).' },
            confianca: { type: 'string', enum: ['alta', 'media', 'baixa'] },
          },
          required: ['nome', 'evidencia', 'confianca'],
        },
      },
      resumo: { type: 'string', description: 'Duas ou três frases: onde procurou, o que achou, o que faltou.' },
    },
    required: ['candidatos', 'resumo'],
  },
}

const FERRAMENTA_PLACES: Anthropic.Messages.Tool = {
  name: 'buscar_google_places',
  description: 'Busca empresas no Google Maps (Places) por texto, ex.: "confecção de camisetas em Caruaru PE". Devolve nome, endereço, telefone e site. Use pra achar telefone quando o perfil não tem.',
  input_schema: { type: 'object', properties: { consulta: { type: 'string', minLength: 5, maxLength: 120 } }, required: ['consulta'] },
}

function promptBusca(perfil: PerfilBusca, regiao: RegiaoBusca, quantos: number, temPlaces: boolean): string {
  return `Você é o pesquisador de fornecedores da Confeccione, marketplace que conecta quem precisa produzir roupas a confecções verificadas no Brasil (sede em Recife). Um pedido está sem confecção e você vai achar quem pode produzi-lo.

PEDIDO: ${perfil.descricao}${perfil.prazoDias ? `, prazo desejado de ${perfil.prazoDias} dias` : ''}. Entrega em ${[perfil.cidade, perfil.uf].filter(Boolean).join('/') || 'local não informado'}. Peças: ${perfil.modelos.join(', ')}. ${perfil.materiais.length ? `Materiais: ${perfil.materiais.join(', ')}. ` : ''}${perfil.tecnicas.length ? `Técnicas: ${perfil.tecnicas.join(', ')}. ` : ''}

ONDE PROCURAR: ${descricaoDaRegiao(perfil, regiao)}.

COMO PROCURAR: use a busca na web várias vezes, com consultas diferentes, em português: "confecção de ${perfil.modelos[0]} em <cidade>", "facção ${perfil.modelos[0]} <UF> whatsapp", "fábrica de ${perfil.modelos[0]} <cidade> atacado", "site:instagram.com confecção ${perfil.modelos[0]} <cidade>", "ateliê de costura ${perfil.modelos[0]} <UF>"${temPlaces ? ', e a ferramenta buscar_google_places pra pegar telefone e site de empresas do Google Maps' : ''}. Leia os trechos: perfis do Instagram costumam trazer cidade e WhatsApp na bio; sites trazem e-mail e telefone.

QUEM SERVE: confecção, facção, ateliê, estamparia ou fábrica que PRODUZ esse tipo de peça sob demanda ou no atacado, com pelo menos um contato (WhatsApp, telefone ou e-mail). QUEM NÃO SERVE: loja que só vende, marca própria que não produz pra terceiros, marketplace, blog, diretório sem contato, a própria Confeccione, e qualquer página em que você não tenha certeza de que é um fabricante. Não invente contato: só registre WhatsApp, e-mail ou site que apareceram nos resultados. Se um número vier com traços ou parênteses, normalize só pra dígitos com DDD.

ENTREGA: até ${quantos} candidatos, os mais prováveis primeiro, cada um com uma frase de evidência (o que a página diz que a faz servir) e a URL de origem. No fim chame registrar_candidatos uma única vez. Sem texto além do necessário.`
}

export type ResultadoBusca = {
  candidatos: Candidato[]
  consultas: string[]
  resumo: string
  tokensEntrada: number
  tokensSaida: number
  buscasWeb: number
  rodadas: number
}

export async function descobrirCandidatos(perfil: PerfilBusca, regiao: RegiaoBusca, quantos: number): Promise<ResultadoBusca> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY ausente')
  const client = new Anthropic({ apiKey })
  const temPlaces = Boolean(process.env.GOOGLE_PLACES_API_KEY)

  const tools: Anthropic.Messages.ToolUnion[] = [
    { type: 'web_search_20250305', name: 'web_search', max_uses: MAX_BUSCAS_WEB, user_location: { type: 'approximate', country: 'BR', timezone: 'America/Recife' } },
    FERRAMENTA_REGISTRAR,
    ...(temPlaces ? [FERRAMENTA_PLACES] : []),
  ]
  const historico: Anthropic.Messages.MessageParam[] = [
    { role: 'user', content: `Encontre confecções pra este pedido e registre com registrar_candidatos.` },
  ]
  const consultas: string[] = []
  let tokensEntrada = 0
  let tokensSaida = 0
  let buscasWeb = 0
  let rodadas = 0
  let registro: { candidatos: unknown; resumo?: unknown } | null = null

  while (rodadas < MAX_RODADAS_BUSCA && !registro) {
    rodadas++
    const resposta = await client.messages.create({
      model: MODELO,
      max_tokens: MAX_TOKENS_BUSCA,
      system: promptBusca(perfil, regiao, quantos, temPlaces),
      tools,
      messages: historico,
    })
    void registrarUsoIa('captacao-busca', MODELO, resposta.usage)
    tokensEntrada += resposta.usage?.input_tokens ?? 0
    tokensSaida += resposta.usage?.output_tokens ?? 0
    buscasWeb += resposta.usage?.server_tool_use?.web_search_requests ?? 0

    for (const b of resposta.content) {
      if (b.type === 'server_tool_use' && b.name === 'web_search') {
        const q = (b.input as { query?: string })?.query
        if (q) consultas.push(q)
      }
    }

    const usos = resposta.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use')
    if (resposta.stop_reason === 'pause_turn') {
      historico.push({ role: 'assistant', content: resposta.content })
      continue
    }
    if (resposta.stop_reason !== 'tool_use' || usos.length === 0) {
      // Terminou sem registrar: pede o registro explicitamente, só com a ferramenta final.
      historico.push({ role: 'assistant', content: resposta.content })
      const forcada = await client.messages.create({
        model: MODELO,
        max_tokens: MAX_TOKENS_BUSCA,
        system: promptBusca(perfil, regiao, quantos, temPlaces),
        tools: [FERRAMENTA_REGISTRAR],
        tool_choice: { type: 'tool', name: 'registrar_candidatos' },
        messages: [...historico, { role: 'user', content: 'Registre agora o que encontrou com registrar_candidatos (lista vazia se nada servir).' }],
      })
      void registrarUsoIa('captacao-busca', MODELO, forcada.usage)
      tokensEntrada += forcada.usage?.input_tokens ?? 0
      tokensSaida += forcada.usage?.output_tokens ?? 0
      const uso = forcada.content.find((b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use' && b.name === 'registrar_candidatos')
      registro = (uso?.input as typeof registro) ?? { candidatos: [], resumo: 'sem registro' }
      break
    }

    historico.push({ role: 'assistant', content: resposta.content })
    const resultados: Anthropic.Messages.ToolResultBlockParam[] = []
    for (const uso of usos) {
      if (uso.name === 'registrar_candidatos') {
        registro = uso.input as typeof registro
        resultados.push({ type: 'tool_result', tool_use_id: uso.id, content: 'ok' })
      } else if (uso.name === 'buscar_google_places') {
        const consulta = str((uso.input as { consulta?: unknown })?.consulta) ?? ''
        consultas.push(`[places] ${consulta}`)
        const lugares = await buscarGooglePlaces(consulta)
        resultados.push({ type: 'tool_result', tool_use_id: uso.id, content: JSON.stringify(lugares).slice(0, 20_000) })
      } else {
        resultados.push({ type: 'tool_result', tool_use_id: uso.id, content: `Erro: ferramenta desconhecida ${uso.name}`, is_error: true })
      }
    }
    historico.push({ role: 'user', content: resultados })
  }

  const brutos = Array.isArray(registro?.candidatos) ? (registro!.candidatos as Record<string, unknown>[]) : []
  const vistos = new Set<string>()
  const candidatos: Candidato[] = []
  for (const raw of brutos) {
    const c = normalizarCandidato(raw)
    if (!c) continue
    const chave = c.whatsapp ?? c.email ?? c.telefone ?? c.nome.toLowerCase()
    if (vistos.has(chave)) continue
    vistos.add(chave)
    candidatos.push(c)
  }
  const ordem = { alta: 0, media: 1, baixa: 2 }
  candidatos.sort((a, b) => ordem[a.confianca] - ordem[b.confianca])
  return { candidatos, consultas, resumo: str(registro?.resumo) ?? '', tokensEntrada, tokensSaida, buscasWeb, rodadas }
}

// ─── Dedupe: quem já conhecemos ─────────────────────────────────────────────

type MotivoDescarte = 'ja_fornecedor' | 'ja_na_captacao' | 'pediu_para_nao_receber' | 'sem_contato_util'

/** Fornecedor já cadastrado, do jeito que dá pra comparar com o que a busca acha. */
type FornecedorBase = { id: string; nome: string | null; cidade: string | null; estado: string | null; whatsapp: string | null; email: string | null; instagram: string | null; site: string | null }

/**
 * A base inteira de fornecedores (é pequena) carregada uma vez por busca:
 * comparar em memória é mais seguro que montar filtros — o Fernando pediu
 * cuidado pra nunca abordar quem já está na base.
 */
async function carregarBaseFornecedores(): Promise<FornecedorBase[]> {
  const { data } = await supabaseAdmin.from('leads_fornecedores').select('id, nome, cidade, estado, whatsapp, email, instagram, site').limit(2000)
  return (data ?? []) as FornecedorBase[]
}

/** Nome comparável: minúsculo, sem acento, sem pontuação e sem as palavras que toda confecção tem. */
function nomeChave(nome: string | null | undefined): string {
  return (nome ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(confeccoes?|confeccao|malharia|malhas|faccao|atelie|ateliê|fabrica|industria|textil|uniformes?|ltda|me|eireli|epp|sa|e|de|da|do|dos|das)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function hostDoSite(site: string | null | undefined): string | null {
  if (!site) return null
  try {
    return new URL(/^https?:\/\//i.test(site) ? site : `https://${site}`).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

/** O candidato bate com alguém da base? Por WhatsApp/telefone, e-mail, @instagram, site ou nome+cidade. */
export function ehFornecedorDaBase(c: Candidato, base: FornecedorBase[]): boolean {
  const last8 = (c.whatsapp ?? c.telefone ?? '').replace(/\D/g, '').slice(-8)
  const email = c.email?.toLowerCase() ?? null
  const insta = c.instagram?.toLowerCase() ?? null
  const host = hostDoSite(c.site)
  const nome = nomeChave(c.nome)
  const cidade = (c.cidade ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  return base.some((f) => {
    if (last8.length === 8 && (f.whatsapp ?? '').replace(/\D/g, '').endsWith(last8)) return true
    if (email && (f.email ?? '').toLowerCase() === email) return true
    if (insta && f.instagram && instagramHandle(f.instagram) === insta) return true
    if (host && hostDoSite(f.site) === host) return true
    if (nome.length >= 4 && nomeChave(f.nome) === nome) {
      const cidadeBase = (f.cidade ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
      // Mesmo nome e mesma cidade (ou cidade desconhecida de um dos lados): é a mesma confecção.
      if (!cidade || !cidadeBase || cidade === cidadeBase) return true
    }
    return false
  })
}

async function motivoParaDescartar(c: Candidato, base: FornecedorBase[]): Promise<MotivoDescarte | null> {
  const last8 = c.whatsapp?.slice(-8) ?? c.telefone?.slice(-8) ?? null
  if (!last8 && !c.email) return 'sem_contato_util'
  if (ehFornecedorDaBase(c, base)) return 'ja_fornecedor'

  {
    let q = supabaseAdmin.from('captacao_fornecedores').select('id, resposta, status').limit(3)
    const partes: string[] = []
    if (last8) partes.push(`whatsapp.ilike.%${last8}`)
    if (c.email) partes.push(`email.ilike.${c.email}`)
    if (c.instagram) partes.push(`instagram.eq.${c.instagram}`)
    q = q.or(partes.join(','))
    const { data } = await q
    const linhas = (data ?? []) as Array<{ id: string; resposta: string | null; status: string }>
    if (linhas.some((l) => l.resposta === 'opt_out' || l.resposta === 'recusou')) return 'pediu_para_nao_receber'
    if (linhas.length) return 'ja_na_captacao'
  }
  return null
}

// ─── Teto diário e por pedido ───────────────────────────────────────────────

function inicioDoDiaRecife(): string {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Recife', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return new Date(`${partes}T03:00:00.000Z`).toISOString() // 00:00 em Recife (UTC-3)
}

/**
 * TETO QUE NÃO SABE CONTAR NÃO É TETO — 11/09/2026.
 *
 * As duas contagens abaixo alimentam `max_por_dia` e `max_por_pedido`. Nenhuma
 * olhava `error`, e o `count ?? 0` transformava falha em zero — isto é, em
 * "ainda não abordamos ninguém hoje". O teto diário virava 0/12 e a rodada
 * saía mandando mensagem fria com a trava aberta. Contagem que falha estoura.
 */
export async function contatadosHoje(): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('captacao_fornecedores')
    .select('id', { count: 'exact', head: true })
    .eq('origem', 'pedido')
    .gte('ultimo_contato_em', inicioDoDiaRecife())
  if (error) throw new Error(`contagem do teto diário: ${error.message}`)
  return count ?? 0
}

async function contatadosDoPedido(pedidoId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('captacao_fornecedores')
    .select('id', { count: 'exact', head: true })
    .eq('pedido_id', pedidoId)
    .not('ultimo_contato_em', 'is', null)
  if (error) throw new Error(`contagem do teto do pedido ${pedidoId}: ${error.message}`)
  return count ?? 0
}


// ─── Cadastro feito na conversa ─────────────────────────────────────────────
/**
 * Cria a confecção em `leads_fornecedores` a partir da conversa, JÁ APROVADA.
 *
 * DECISÃO DO FERNANDO — 12/09/2026: nasce aprovado. A troca é explícita: sem
 * revisão humana depois, a CONVERSA é a revisão. Por isso o rigor que ia morar
 * no olho dele migrou pra cá, e as travas abaixo são de código, não de prompt —
 * o prompt já provou que não segura (o PDF saiu três vezes com o prompt dizendo
 * que já tinha ido).
 *
 * Por que isso existe: 45 leads, 5 responderam, 4 disseram que fazem, ZERO
 * viraram fornecedor. O link do formulário converteu 0 de 4. A Bordado Mágico
 * chegou a dizer "vou pedir pra que o cadastro seja efetuado" e não voltou —
 * mandar alguém preencher site no meio de uma conversa é perder a conversa.
 *
 * NADA DE DADO SENSÍVEL AQUI: sem CNPJ, sem dado bancário. Isso é do momento do
 * primeiro pagamento, e por link.
 */
async function cadastrarConfeccaoDaConversa(
  cand: CandidatoLinha,
  entrada: Record<string, unknown>,
  waId: string,
  nomeContato: string | null
): Promise<{ ok: boolean; pendente?: boolean; aviso: string }> {
  // TRAVA 1 — ELA TEM QUE TER CONFIRMADO.
  // O formulário dá de graça uma coisa que a conversa perde: a pessoa VÊ o que
  // preencheu antes de enviar. Na conversa isso só existe se for explícito.
  if (entrada.confirmado_por_ela !== true) {
    return {
      ok: false,
      aviso:
        'Você ainda não confirmou com ela. Repita numa mensagem só o que entendeu (produtos, cidade, ' +
        'pedido mínimo) e pergunte se está certo. Só chame esta ferramenta depois do sim dela.',
    }
  }

  // TRAVA 2 — TEM QUE HAVER UMA RESPOSTA DELA, DE UM DOS DOIS TIPOS.
  //
  // `interessado`  = ela faz a peça do pedido.
  // `nao_produz`   = ela NÃO faz esta peça, mas contou o que faz e topou entrar.
  //                  Um "não" pra esta peça não é um "não" pra plataforma: a
  //                  confecção que não faz calça jeans pode ser exatamente quem
  //                  falta no pedido da semana que vem.
  //
  // Os outros estados (`recusou`, `depois`, `opt_out`) e o silêncio continuam
  // barrando: cadastro sem convencimento produz fornecedor que recusa o fluxo de
  // pagamento na primeira oferta, e isso é pior que não ter cadastrado.
  //
  // Sem valor novo de propósito: `resposta` tem CHECK constraint
  // (interessado | recusou | depois | nao_produz | opt_out), e `nao_produz` já
  // significa exatamente o galho (b). Inventar `interessado_outros` exigiria
  // migração pra dizer o que a coluna já diz.
  const RESPOSTAS_QUE_PERMITEM_CADASTRO = ['interessado', 'nao_produz']
  if (!RESPOSTAS_QUE_PERMITEM_CADASTRO.includes(cand.resposta ?? '')) {
    return {
      ok: false,
      aviso:
        'Registre antes com registrar_resposta: `interessado` se ela faz a peça do pedido, `nao_produz` se ela ' +
        'não faz mas contou o que faz. Sem um dos dois não dá pra cadastrar.',
    }
  }

  // TRAVA 3 — PEDIDO MÍNIMO É NÚMERO.
  // "Depende" e "a partir de pouquinho" não gravam: o match usa este número pra
  // decidir se oferta, e um zero silencioso faz ela receber pedido de 1 peça.
  const minimo = typeof entrada.pedido_minimo === 'number' && Number.isFinite(entrada.pedido_minimo) && entrada.pedido_minimo > 0
    ? Math.round(entrada.pedido_minimo)
    : null
  if (minimo === null) {
    return {
      ok: false,
      aviso:
        'Faltou o pedido mínimo em número. Pergunte com âncora: "me dá um número, abaixo de quanto não ' +
        'compensa ligar a máquina?" — "depende" não grava.',
    }
  }

  const cidade = str(entrada.cidade)
  const estado = (str(entrada.estado) ?? '').toUpperCase().slice(0, 2)
  if (!cidade || estado.length !== 2) {
    return { ok: false, aviso: 'Faltou cidade ou estado (UF com duas letras).' }
  }

  // TRAVA 4 — O QUE ELA DISSE VIRA CATÁLOGO AQUI, NÃO NA CABEÇA DO MODELO.
  //
  // Ela responde em texto livre ("camiseta, moletom e boné", "bordado em peça
  // pronta"). `pecaDaLinha` traduz cada item pro id do catálogo, ou devolve null.
  // Medido em 18 respostas plausíveis: 13 resolvem. Das 5 que não, TRÊS são
  // serviço e não peça — "estamparia", "facção", "bordado em peça pronta" — e
  // pendente ali é a resposta certa, não uma falha do casador.
  //
  // A trava vale sobre o RESULTADO: se ela citar três e o casador reconhecer
  // dois, grava os dois e segue. Só cai em `pendente` quando NENHUM for
  // reconhecido — e aí o texto dela inteiro vai pro `pecas_outro`, pro Fernando
  // decidir se o catálogo cresce (ver beca/estola/kimono no DEBT.md).
  const ditos = Array.isArray(entrada.produtos)
    ? entrada.produtos.map((x) => String(x).trim()).filter(Boolean).slice(0, 8)
    : []
  const pecas = [...new Set(ditos.map((d) => pecaDaLinha(d)).filter((x): x is string => Boolean(x)))]
  const foraDoCatalogo = ditos.length > 0 ? ditos.join('; ') : null

  // SAÍDA DE ESCAPE — o ÚNICO caminho que nasce pendente.
  // Se o que ela faz não cabe no catálogo, não força o encaixe: peça errada
  // manda pedido errado, e isso queima a confecção na primeira oferta. Grava o
  // que ela disse, marca pendente e chama o Fernando. Ampliar o catálogo é
  // decisão de produto (ver beca/estola/kimono no DEBT.md).
  const pendente = pecas.length === 0
  if (pendente && !foraDoCatalogo) {
    return { ok: false, aviso: 'Pergunte o que ela faz e mande no campo produtos, nas palavras dela.' }
  }

  // IDEMPOTENTE PELOS ÚLTIMOS 8 DÍGITOS (nono dígito: ver AGENTS.md).
  const tel = normalizarWhatsApp(cand.whatsapp ?? waId)
  const oito = tel.replace(/\D/g, '').slice(-8)
  const { data: existente } = await supabaseAdmin
    .from('leads_fornecedores')
    .select('id, pecas')
    .ilike('whatsapp', `%${oito}`)
    .maybeSingle<{ id: string; pecas: string[] | null }>()

  const campos = {
    nome: cand.nome ?? nomeContato ?? 'Confecção',
    whatsapp: tel,
    email: str(entrada.email)?.toLowerCase() ?? cand.email ?? null,
    cidade,
    estado,
    pedido_minimo: minimo,
    pecas,
    pecas_outro: foraDoCatalogo,
    // SEM `origem` AQUI: a coluna NÃO EXISTE em leads_fornecedores (conferido
    // no schema; um insert com ela voltaria 42703 e o cadastro quebraria na
    // primeira confecção). A medição que ela serviria sai de outro lado e sem
    // migração: `captacao_fornecedores.status='convertido'` + `convertido_em`,
    // que esta função já grava logo abaixo, casado por últimos 8 dígitos.
    // Nasce aprovado no caminho feliz. Pendente SÓ quando a peça não coube.
    aprovacao_status: pendente ? 'pendente' : 'aprovado',
    status: 'ativo',
  }

  let fornecedorId: string
  if (existente) {
    // União das peças: ela pode ter se cadastrado antes com outras.
    const uniao = [...new Set([...(existente.pecas ?? []), ...pecas])]
    const { error } = await supabaseAdmin.from('leads_fornecedores').update({ ...campos, pecas: uniao }).eq('id', existente.id)
    if (error) return { ok: false, aviso: `Não deu pra atualizar o cadastro: ${error.message}` }
    fornecedorId = existente.id
  } else {
    const { data, error } = await supabaseAdmin.from('leads_fornecedores').insert(campos).select('id').single<{ id: string }>()
    if (error || !data) return { ok: false, aviso: `Não deu pra criar o cadastro: ${error?.message ?? 'sem id'}` }
    fornecedorId = data.id
  }

  // Liga o contato do WhatsApp ao fornecedor: é o que faz o inbox mostrar o selo
  // e o que o `salvar_perfil_producao` exige pra completar o perfil depois.
  await supabaseAdmin.from('wa_contatos').update({ fornecedor_id: fornecedorId }).eq('wa_id', waId)

  // MEDIÇÃO SEM COLUNA NOVA: `convertido_em` já existe e é exatamente a pergunta
  // que importa — "disse que faz -> virou fornecedor", hoje 0 de 4.
  await supabaseAdmin
    .from('captacao_fornecedores')
    .update({ status: 'convertido', convertido_em: new Date().toISOString(), proximo_envio_em: null })
    .eq('id', cand.id)

  return {
    ok: true,
    pendente,
    aviso: pendente
      ? 'Cadastro criado, mas as peças dela não estão no catálogo: ficou pendente e o Fernando vai olhar. ' +
        'Diga a ela que está tudo certo e que você avisa quando chegar pedido do tipo dela.'
      // "PARE AQUI" é literal: cadastrar e assumir o pedido são dois
      // consentimentos, e juntar os dois faz ela aceitar o que não leu.
      : 'Cadastro criado e JÁ APROVADO: ela entra no matching agora. Diga a frase de pronto e PARE. ' +
        'Não diga que o pedido é dela, não mande dados do cliente, não prometa entrega — assumir a produção é outra conversa.',
  }
}

// ─── PDF de sondagem (sem nome nem contato do cliente) ──────────────────────

export async function pdfSondagem(pedidoId: string): Promise<{ bytes: Uint8Array; nomeArquivo: string } | null> {
  const { data } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, codigo, linhas, prazo_dias, cidade, uf, mockups, imagens')
    .eq('id', pedidoId)
    .maybeSingle<Record<string, unknown>>()
  if (!data) return null
  const pedido: ResumoPedido = {
    id: String(data.id),
    nome: null,
    linhas: Array.isArray(data.linhas) ? (data.linhas as ResumoPedido['linhas']) : [],
    prazoDias: (data.prazo_dias as number | null) ?? null,
    cidade: (data.cidade as string | null) ?? null,
    uf: (data.uf as string | null) ?? null,
    codigo: (data.codigo as string | null) ?? null,
    mockups: (data.mockups as ResumoPedido['mockups']) ?? null,
    imagens: Array.isArray(data.imagens) ? (data.imagens as string[]) : null,
  }
  const bytes = await gerarResumoPedidoPdf(pedido)
  return { bytes, nomeArquivo: `confeccione-sondagem-${pedido.id.slice(0, 8)}.pdf` }
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

// ─── Mensagens da sondagem ──────────────────────────────────────────────────

function lugarEntrega(perfil: PerfilBusca): string {
  return [perfil.cidade, perfil.uf].filter(Boolean).join('/') || 'Brasil'
}

/**
 * Abertura fria pelo WhatsApp — de propósito só "tirar uma dúvida" (ideia do
 * Fernando, 08/09): o template curto passa melhor na Meta e puxa resposta; o
 * pedido, o PDF e o convite pro cadastro vêm em texto livre, pelo Luigi,
 * quando a confecção responde. Tem que bater com o corpo do template
 * `sondagem_producao` ({{1}} = nome da confecção).
 */
export function textoSondagemWhatsApp(nomeConfeccao: string | null): string {
  const oi = nomeConfeccao ? `Oi, ${nomeConfeccao}, tudo bem?` : 'Oi, tudo bem?'
  return `${oi} Aqui é o Luigi, da Confeccione. Gostaria de tirar uma dúvida sobre uma produção com vocês.`
}

export function assuntoSondagem(perfil: PerfilBusca): string {
  return `Vocês produzem ${perfil.descricao}? Pedido pra ${lugarEntrega(perfil)}`
}

export function corpoSondagemEmail(perfil: PerfilBusca, nomeConfeccao: string | null, linkOptOut: string): string {
  return [
    nomeConfeccao ? `Oi, ${nomeConfeccao}.` : 'Oi.',
    `Aqui é o Luigi, da Confeccione, marketplace de confecção com sede em Recife. Temos um pedido de ${perfil.descricao} pra entregar em ${lugarEntrega(perfil)}${perfil.prazoDias ? `, com prazo desejado de ${perfil.prazoDias} dias` : ''}, e estamos procurando uma confecção que produza.`,
    `Vocês fazem esse tipo de peça nessa quantidade? O resumo do pedido está em anexo, sem os dados do cliente.`,
    `Se fizerem, é só responder este e-mail com um sim que eu passo os detalhes. Pra receber o pedido e negociar pela plataforma, o cadastro leva cinco minutos: ${URL_CADASTRO_FORNECEDOR}`,
    `Se não for o perfil de vocês, um não já ajuda. Pra não receber mais pedidos da Confeccione: ${linkOptOut}`,
    'Luigi, da Confeccione',
  ].join('\n\n')
}

export function linkOptOutCaptacao(id: string): string {
  return `https://confeccione.com.br/api/captacao/descadastrar?c=${id}`
}

// ─── Abordagem ──────────────────────────────────────────────────────────────

export type ResultadoAbordagem = { id: string; email: boolean | null; whatsapp: boolean | null; erro: string | null }

/**
 * Grava o candidato em captacao_fornecedores (origem 'pedido') e manda a
 * sondagem pelos canais que ele tem. `enviar=false` (modo sugere) só grava,
 * com status 'sugerido', pra alguém abordar depois pelo admin.
 */
export async function abordarCandidato(c: Candidato, perfil: PerfilBusca, enviar: boolean, pdf: { bytes: Uint8Array; nomeArquivo: string } | null): Promise<ResultadoAbordagem> {
  const agora = new Date().toISOString()
  // O NÚMERO É UM SÓ — 11/09/2026.
  //
  // A coluna `whatsapp` sempre gravou `c.whatsapp ?? c.telefone`, mas a flag
  // `canal_whatsapp` olhava só `c.whatsapp`. Candidato que a busca devolvia com
  // telefone e sem whatsapp ficava com número no banco e flag `false` — e como
  // o envio usava o objeto em memória (onde `c.whatsapp` é nulo), não saía nada
  // por canal nenhum. A linha virava `status='erro'` com `ultimo_erro` VAZIO,
  // porque nenhuma tentativa chegou a acontecer pra gerar mensagem de erro.
  //
  // Pior: `reabordarPendentes` anula o whatsapp de quem tem `canal_whatsapp`
  // falso, então essas linhas nunca mais eram tentadas. Cinco confecções reais,
  // com telefone no banco, paradas desde 08/09 — achadas e pagas em token, e
  // invisíveis pro sistema que as procurou.
  //
  // Agora o número resolvido é calculado UMA vez e usado nos três lugares:
  // coluna, flag e envio. Se o número não for de WhatsApp, o envio falha com
  // erro de verdade e o `reabordarPendentes` tenta de novo até MAX_TENTATIVAS —
  // que é o comportamento certo pra um palpite, e é visível.
  // Sem `?? c.telefone` cru: o fallback antigo escrevia fixo não normalizado na
  // coluna `whatsapp` e furava a classificação acima. O número vem de uma regra
  // só, e ela já devolve E.164.
  const numero = telefoneParaWaId(c.whatsapp ?? c.telefone).whatsapp
  const { data: linha, error } = await supabaseAdmin
    .from('captacao_fornecedores')
    .insert({
      nome: c.nome,
      email: c.email,
      whatsapp: numero,
      segmento: perfil.segmento,
      etapa: 0,
      status: enviar ? 'ativo' : 'sugerido',
      canal_email: Boolean(c.email),
      canal_whatsapp: Boolean(numero),
      origem: 'pedido',
      pedido_id: perfil.pedidoId,
      cidade: c.cidade,
      uf: c.uf,
      instagram: c.instagram,
      site: c.site,
      fonte: c.fonte,
      evidencia: c.evidencia,
      ator: 'agente_captacao',
      criado_em: agora,
      atualizado_em: agora,
    })
    .select('id')
    .single<{ id: string }>()
  if (error || !linha) return { id: '', email: null, whatsapp: null, erro: error?.message ?? 'não gravou' }
  if (!enviar) return { id: linha.id, email: null, whatsapp: null, erro: null }
  // Manda o que FOI GRAVADO, não o objeto cru da busca — era essa diferença que
  // fazia o candidato só-telefone não receber nada.
  return await enviarSondagem(linha.id, { nome: c.nome, email: c.email, whatsapp: numero }, perfil, pdf)
}

/** Manda (ou remanda) a sondagem de um candidato já gravado. */
export async function enviarSondagem(id: string, c: { nome: string | null; email: string | null; whatsapp: string | null }, perfil: PerfilBusca, pdf: { bytes: Uint8Array; nomeArquivo: string } | null): Promise<ResultadoAbordagem> {
  const agora = new Date().toISOString()
  let email: boolean | null = null
  let whatsapp: boolean | null = null
  const erros: string[] = []

  if (c.email) {
    const r = await emailSondagemProducao({
      para: c.email,
      assunto: assuntoSondagem(perfil),
      corpo: corpoSondagemEmail(perfil, c.nome, linkOptOutCaptacao(id)),
      anexo: pdf ? { nome: pdf.nomeArquivo, base64: base64(pdf.bytes) } : null,
    })
    email = r.ok
    if (!r.ok) erros.push(`e-mail: ${r.erro}`)
  }

  if (c.whatsapp) {
    if (!(await templateSondagemAprovado())) {
      whatsapp = false
      erros.push(`whatsapp: template ${TEMPLATE_SONDAGEM} ainda não aprovado na Meta`)
    } else {
      // O NÚMERO JÁ É CLIENTE? — 12/09/2026.
      //
      // A Nany levou duas sondagens sendo cliente, porque o contato dela tinha
      // sido carimbado com o `fornecedor_id` de outra pessoa. Aqui é o último
      // ponto antes de a mensagem sair: se o número está nas duas pontas, o
      // Fernando fica sabendo AGORA, com os três nomes, em vez de descobrir na
      // conversa. Não bloqueia o envio — quem decide é ele, e bloquear em cima
      // de um empate que 2 em 4 vezes é legítimo tiraria confecção de verdade.
      const vinculo = await vincularContato(normalizarWaId(c.whatsapp), c.nome)
      if (vinculo.conflito) void avisarGestor(`Captação ia sondar um número que também é cliente. ${vinculo.conflito}`)

      const r = await enviarTemplate(c.whatsapp, TEMPLATE_SONDAGEM, IDIOMA_TEMPLATE_SONDAGEM, [
        { type: 'body', parameters: [{ type: 'text', text: (c.nome || 'pessoal').slice(0, 60) }] },
      ])
      whatsapp = r.ok
      if (r.ok) await registrarSaidaInbox(c.whatsapp, c.nome, r.wamid, textoSondagemWhatsApp(c.nome), TEMPLATE_SONDAGEM, 'luigi')
      else erros.push(`whatsapp: ${r.erro}`)
    }
  }

  // Sem nenhum canal não é "tentou e falhou", é "não havia o que tentar" — e
  // isso precisa virar texto, senão a linha fica `erro` com motivo em branco e
  // ninguém descobre por quê (foi como as 5 de 08 e 10/09 passaram despercebidas).
  if (!c.email && !c.whatsapp) erros.push('candidato sem e-mail e sem número utilizável')

  const enviouAlgo = email === true || whatsapp === true
  // Cadência antiga (follow-ups por segmento, só e-mail): +5 dias.
  const proximo = new Date()
  proximo.setDate(proximo.getDate() + 5)
  await supabaseAdmin
    .from('captacao_fornecedores')
    .update({
      status: enviouAlgo ? 'ativo' : 'erro',
      ultimo_envio_em: enviouAlgo ? agora : null,
      ultimo_contato_em: enviouAlgo ? agora : null,
      proximo_envio_em: enviouAlgo && c.email ? proximo.toISOString() : null,
      ultimo_erro: erros.length ? erros.join(' | ').slice(0, 500) : null,
      erros: erros.length ? 1 : 0,
      atualizado_em: agora,
    })
    .eq('id', id)
  return { id, email, whatsapp, erro: erros.length ? erros.join(' | ') : null }
}

// ─── A rodada: pedidos sem fornecedor → buscas → abordagens ─────────────────

export type ResultadoRodada = {
  pedidos_olhados: number
  buscas: Array<{ pedido: string; regiao: RegiaoBusca; encontrados: number; novos: number; contatados: number; erro: string | null }>
  contatados_hoje_antes: number
  /** Candidatos que tinham ficado sem canal (template pendente, Resend fora) e receberam a sondagem nesta rodada. */
  reabordados: number
  /** Pedidos que a rodada deixou quietos de propósito, e por quê. Sem isto, o log de "0 buscas" fica igual ao de agente quebrado. */
  segurados: Array<{ pedido: string; motivo: string; contatados: number; responderam: number }>
  pulado: string | null
}

const MAX_TENTATIVAS_SONDAGEM = 3

/**
 * Segunda chance pra quem ficou sem nenhum canal na abordagem: confecção só
 * com WhatsApp enquanto o template estava pendente na Meta, ou e-mail que o
 * Resend recusou (limite do dia). Enquanto o pedido seguir sem confecção e
 * dentro dos tetos, a rodada tenta de novo — é o que faz o WhatsApp da
 * sondagem "ligar sozinho" no dia em que a Meta aprovar, sem env nem deploy.
 * Quem só tem WhatsApp não gasta tentativa enquanto o template não sair.
 */
async function reabordarPendentes(pedidos: PedidoEtapa[], config: ConfigCaptacao): Promise<number> {
  if (pedidos.length === 0) return 0
  type Pendente = { id: string; nome: string | null; email: string | null; whatsapp: string | null; canal_whatsapp: boolean | null; pedido_id: string; erros: number | null }
  const { data } = await supabaseAdmin
    .from('captacao_fornecedores')
    .select('id, nome, email, whatsapp, canal_whatsapp, pedido_id, erros')
    .eq('origem', 'pedido')
    .eq('status', 'erro')
    .is('ultimo_contato_em', null)
    .is('resposta', null)
    .lt('erros', MAX_TENTATIVAS_SONDAGEM)
    .in('pedido_id', pedidos.map((p) => p.id))
    .order('criado_em', { ascending: true })
    .limit(60)
  const pendentes = (data ?? []) as Pendente[]
  if (pendentes.length === 0) return 0

  const waAprovado = pendentes.some((c) => c.canal_whatsapp && c.whatsapp) ? await templateSondagemAprovado() : false
  const fila = pendentes
    .map((c) => ({ ...c, whatsapp: c.canal_whatsapp && waAprovado ? c.whatsapp : null }))
    .filter((c) => c.email || c.whatsapp)
  if (fila.length === 0) return 0

  let reabordados = 0
  const porPedido = new Map<string, { perfil: PerfilBusca; pdf: { bytes: Uint8Array; nomeArquivo: string } | null; contatados: number }>()
  for (const c of fila) {
    if (config.max_por_dia - (await contatadosHoje()) <= 0) break
    let ctx = porPedido.get(c.pedido_id)
    if (!ctx) {
      const pedido = pedidos.find((p) => p.id === c.pedido_id)
      if (!pedido) continue
      ctx = {
        perfil: perfilDeBusca(pedido, await prazoDoPedido(pedido.id)),
        pdf: await pdfSondagem(pedido.id).catch(() => null),
        contatados: await contatadosDoPedido(pedido.id),
      }
      porPedido.set(c.pedido_id, ctx)
    }
    if (ctx.contatados >= config.max_por_pedido) continue
    const r = await enviarSondagem(c.id, { nome: c.nome, email: c.email, whatsapp: c.whatsapp }, ctx.perfil, ctx.pdf)
    if (r.email || r.whatsapp) {
      reabordados++
      ctx.contatados++
    } else {
      await supabaseAdmin.from('captacao_fornecedores').update({ erros: (c.erros ?? 0) + 1 }).eq('id', c.id)
    }
  }
  return reabordados
}

async function prazoDoPedido(pedidoId: string): Promise<number | null> {
  const { data } = await supabaseAdmin.from('pedidos_assistente').select('prazo_dias').eq('id', pedidoId).maybeSingle<{ prazo_dias: number | null }>()
  return data?.prazo_dias ?? null
}

type BuscaAnterior = { regiao: RegiaoBusca; criado_em: string; novos: number | null; contatados: number | null; buscas_web: number | null }

/**
 * Data da última busca de cada pedido, numa consulta só — é a chave de ordem
 * da faixa 2 (ver `ordenarParaAVez`).
 */
async function ultimaBuscaPorPedido(ids: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>()
  if (ids.length === 0) return mapa
  const { data, error } = await supabaseAdmin
    .from('captacao_buscas')
    .select('pedido_id, criado_em')
    .in('pedido_id', ids)
  if (error) throw new Error(`última busca por pedido: ${error.message}`)
  for (const b of (data ?? []) as Array<{ pedido_id: string; criado_em: string }>) {
    const atual = mapa.get(b.pedido_id)
    if (!atual || b.criado_em > atual) mapa.set(b.pedido_id, b.criado_em)
  }
  return mapa
}

/**
 * A ORDEM DA VEZ — 11/09/2026. Duas faixas, mais antigo primeiro dentro de cada.
 *
 *   Faixa 1 — pedido que NUNCA foi buscado, por `confirmado_em` crescente.
 *   Faixa 2 — pedido já buscado, pela data da última busca, crescente.
 *   Faixa 1 inteira antes da faixa 2.
 *
 * A regra antiga era "mais novo primeiro", e com `PEDIDOS_POR_RODADA = 4` os
 * quatro mais recentes ganhavam sempre: em 11/09 havia 9 pedidos elegíveis, e
 * cinco deles estavam parados há 2–3 dias com uma única onda cada. Fome pura.
 *
 * Mais-antigo-puro conserta a fome e cria o espelho: um pedido de 20 dias, que
 * é o menos provável de converter, passaria na frente de um confirmado hoje que
 * não tem confecção NENHUMA olhando. Primeira abordagem é a ação de maior valor
 * que a captação faz — daí a faixa 1 existir.
 *
 * COMO ISTO FALHA (e não está protegido de propósito): se a entrada de pedidos
 * novos por dia passar da cota diária de abordagem, a faixa 1 nunca esvazia e a
 * faixa 2 para de ser atendida — pedido já abordado uma vez jamais recebe a
 * segunda onda, e a fome volta, só que do outro lado. Hoje não acontece nem de
 * longe: `max_por_dia = 12` com `lote = 2` dá ~6 pedidos/dia contra 9 elegíveis
 * no total. Se um dia entrar mais de ~6 pedido novo por dia de forma sustentada,
 * é aqui que quebra, e a saída é reservar uma fatia das vagas pra faixa 2.
 */
function ordenarParaAVez<T extends { id: string; confirmado_em: string | null; desde: string }>(
  pedidos: T[],
  ultimaBusca: Map<string, string>,
): T[] {
  const chave = (p: T) => p.confirmado_em ?? p.desde
  const nunca = pedidos.filter((p) => !ultimaBusca.has(p.id)).sort((a, b) => chave(a).localeCompare(chave(b)))
  const jaForam = pedidos
    .filter((p) => ultimaBusca.has(p.id))
    .sort((a, b) => (ultimaBusca.get(a.id) ?? '').localeCompare(ultimaBusca.get(b.id) ?? ''))
  return [...nunca, ...jaForam]
}

/**
 * Lista vazia aqui MENTE — 11/09/2026. Sem histórico de busca, `regiaoSecou`
 * devolve false pra tudo: a região nunca sobe, `regioesEsgotadas` nunca dispara
 * e o pedido fica preso no estado do cliente pra sempre. É diferente de "este
 * pedido ainda não teve busca", que é uma lista vazia verdadeira.
 */
async function buscasDoPedido(pedidoId: string): Promise<BuscaAnterior[]> {
  const { data, error } = await supabaseAdmin
    .from('captacao_buscas')
    .select('regiao, criado_em, novos, contatados, buscas_web')
    .eq('pedido_id', pedidoId)
    .order('criado_em', { ascending: false })
    .limit(20)
  if (error) throw new Error(`histórico de buscas do pedido ${pedidoId}: ${error.message}`)
  return (data ?? []) as BuscaAnterior[]
}

/**
 * A região secou? Só conta quem de fato foi à web e voltou sem ninguém novo.
 *
 * A onda que sai do banco de reserva grava `novos: 0` porque não descobriu
 * ninguém — ela só usou o que já estava guardado. Sem esta checagem de
 * `buscas_web`, a primeira onda de banco declararia a cidade do cliente
 * esgotada e jogaria o pedido pro Brasil.
 */
function regiaoSecou(anteriores: BuscaAnterior[], regiao: RegiaoBusca): boolean {
  const naWeb = anteriores.filter((a) => a.regiao === regiao && (a.buscas_web ?? 0) > 0)
  return naWeb.length > 0 && (naWeb[0].novos ?? 0) === 0
}

/**
 * A região da vez. Fica onde está enquanto a região ainda entrega gente nova;
 * sobe (estado do cliente → polo de PE → Brasil) quando a última busca ali não
 * achou mais ninguém.
 *
 * A regra antiga era "uma região por busca" (`regioes[anteriores.length]`), o
 * que só fazia sentido quando uma busca varria a cota inteira. Com onda de 2,
 * ela mandaria o terceiro par pro Brasil com a cidade do cliente mal arranhada
 * — e confecção perto é exatamente a que costuma topar.
 */
function regiaoDaVez(anteriores: BuscaAnterior[], regioes: RegiaoBusca[]): RegiaoBusca {
  for (const r of regioes) if (!regiaoSecou(anteriores, r)) return r
  return regioes[regioes.length - 1]
}

/** Todas as regiões já secaram — não adianta o cron insistir neste pedido. */
function regioesEsgotadas(anteriores: BuscaAnterior[], regioes: RegiaoBusca[]): boolean {
  return regioes.every((r) => regiaoSecou(anteriores, r))
}

/** Respostas que encerram o assunto com aquela confecção, pra este pedido. */
const RESPOSTA_FECHA = ['recusou', 'nao_produz', 'opt_out', 'depois']

type OndaAberta = { segura: boolean; motivo: string | null; contatados: number; responderam: number }

/**
 * Olha as confecções já abordadas por este pedido e decide se a próxima onda
 * pode sair. Três saídas:
 *
 *   • alguém respondeu "interessado" → SEGURA. Tem conversa viva; abordar mais
 *     gente agora é pedir orçamento a quatro e ter que dispensar três.
 *   • todo mundo da última onda já respondeu, e nenhum topou → LIBERA na hora.
 *     Esperar 24 h por uma resposta que já chegou é só atraso pro cliente.
 *   • ainda tem gente em silêncio → espera `horas_entre_buscas` e tenta depois.
 */
async function ondaPodeAbrir(pedidoId: string, config: ConfigCaptacao): Promise<OndaAberta> {
  const { data, error } = await supabaseAdmin
    .from('captacao_fornecedores')
    .select('resposta, ultimo_contato_em')
    .eq('origem', 'pedido')
    .eq('pedido_id', pedidoId)
    .not('ultimo_contato_em', 'is', null)
    .order('ultimo_contato_em', { ascending: false })
    .limit(50)
  // Lista vazia aqui é "ninguém foi abordado ainda" — e o portão ABRE a onda.
  // Se a consulta falhar e virar lista vazia, a onda abre sem saber quem já
  // recebeu mensagem, que é como se aborda a mesma confecção duas vezes.
  if (error) throw new Error(`portão da onda do pedido ${pedidoId}: ${error.message}`)
  const abordados = (data ?? []) as Array<{ resposta: string | null; ultimo_contato_em: string }>
  const responderam = abordados.filter((c) => c.resposta).length
  const base = { contatados: abordados.length, responderam }

  if (abordados.length === 0) return { segura: false, motivo: null, ...base }

  if (abordados.some((c) => c.resposta && !RESPOSTA_FECHA.includes(c.resposta))) {
    return { segura: true, motivo: 'confecção interessada em conversa', ...base }
  }

  // A última onda é quem foi abordado junto com o mais recente (mesma janela
  // de alguns minutos). Se todos eles já responderam, não há o que esperar.
  const ultimo = new Date(abordados[0].ultimo_contato_em).getTime()
  const daUltimaOnda = abordados.filter((c) => ultimo - new Date(c.ultimo_contato_em).getTime() < 30 * 60_000)
  if (daUltimaOnda.every((c) => c.resposta)) return { segura: false, motivo: null, ...base }

  const espera = config.horas_entre_buscas * 3600_000
  if (Date.now() - ultimo < espera) {
    const faltam = Math.ceil((espera - (Date.now() - ultimo)) / 3600_000)
    return { segura: true, motivo: `aguardando resposta da última onda (${faltam}h)`, ...base }
  }
  return { segura: false, motivo: null, ...base }
}

type Reserva = { id: string; nome: string | null; email: string | null; whatsapp: string | null }

/**
 * O BANCO DE RESERVA — 10/09/2026.
 *
 * Uma busca na web custa ~4 mil tokens e volta com 5 a 15 confecções; a onda
 * aborda 2. Antes, as outras iam pro lixo e a onda seguinte pagava a busca de
 * novo — às vezes pra reencontrar exatamente as mesmas. Agora elas ficam
 * gravadas como 'sugerido' e a próxima onda começa por aqui: só quando o banco
 * seca é que o agente volta à web.
 */
async function bancoDeReserva(pedidoId: string, limite: number): Promise<Reserva[]> {
  if (limite <= 0) return []
  const { data } = await supabaseAdmin
    .from('captacao_fornecedores')
    .select('id, nome, email, whatsapp')
    .eq('origem', 'pedido')
    .eq('pedido_id', pedidoId)
    .eq('status', 'sugerido')
    .is('ultimo_contato_em', null)
    .is('resposta', null)
    .order('criado_em', { ascending: true })
    .limit(limite)
  return ((data ?? []) as Reserva[]).filter((c) => c.email || c.whatsapp)
}

/**
 * Busca e aborda pra UM pedido. Escolhe a região pela ordem configurada
 * (uf → pe → brasil), uma por busca; respeita os tetos; grava captacao_buscas.
 */
export async function captarParaPedido(
  pedido: PedidoEtapa,
  opts: { origem: 'cron' | 'admin' | 'mcp'; regiao?: RegiaoBusca; forcar?: boolean }
): Promise<ResultadoRodada['buscas'][number]> {
  const inicio = Date.now()
  const { modo, config } = await configCaptacao()
  const anteriores = await buscasDoPedido(pedido.id)
  const regiao: RegiaoBusca = opts.regiao ?? regiaoDaVez(anteriores, config.regioes)
  const saida = { pedido: pedido.codigo ?? pedido.id, regiao, encontrados: 0, novos: 0, contatados: 0, erro: null as string | null }

  const jaContatados = await contatadosDoPedido(pedido.id)
  const restanteDoPedido = config.max_por_pedido - jaContatados
  const restanteDoDia = config.max_por_dia - (await contatadosHoje())
  const enviar = modo === 'responde'
  // O LOTE MANDA NA COTA — 10/09/2026. Uma busca aborda uma onda, não o teto
  // inteiro do pedido; o teto continua valendo como soma de todas as ondas.
  const teto = enviar ? Math.min(restanteDoPedido, restanteDoDia) : restanteDoPedido
  const cota = Math.max(0, Math.min(config.lote, teto))
  if (cota === 0 && !opts.forcar) {
    saida.erro = restanteDoPedido <= 0 ? 'teto por pedido atingido' : 'teto diário atingido'
    return saida
  }

  const perfil = perfilDeBusca(pedido, await prazoDoPedido(pedido.id))
  let busca: ResultadoBusca | null = null
  const descartados: Array<{ nome: string; motivo: string }> = []
  let doBanco = 0
  try {
    // 1) O banco primeiro. Se a onda inteira sai daqui, não há busca na web.
    const pdfBanco = enviar ? await pdfSondagem(pedido.id).catch(() => null) : null
    if (enviar) {
      for (const c of await bancoDeReserva(pedido.id, cota)) {
        if (saida.contatados >= cota) break
        const r = await enviarSondagem(c.id, c, perfil, pdfBanco)
        if (r.email || r.whatsapp) {
          saida.contatados++
          doBanco++
        } else {
          descartados.push({ nome: c.nome ?? '—', motivo: `falha: ${(r.erro ?? 'sem canal').slice(0, 120)}` })
        }
      }
    }
    if (saida.contatados >= cota && !opts.forcar) {
      saida.encontrados = doBanco
      saida.novos = 0
    } else {
      // 2) Banco seco (ou vazio): aí sim procura na web.
      busca = await descobrirCandidatos(perfil, regiao, Math.min(Math.max(cota, 5), 15))
      saida.encontrados = busca.candidatos.length
      const base = await carregarBaseFornecedores()
      for (const c of busca.candidatos) {
        const motivo = await motivoParaDescartar(c, base)
        if (motivo) {
          descartados.push({ nome: c.nome, motivo })
          continue
        }
        saida.novos++
        // Dentro da onda, aborda. Passou da onda, grava como 'sugerido' e
        // espera a vez — é o que o banco de reserva vai consumir amanhã.
        const naOnda = enviar && saida.contatados < cota
        const r = await abordarCandidato(c, perfil, naOnda, pdfBanco)
        if (naOnda && (r.email || r.whatsapp)) saida.contatados++
        if (naOnda && r.erro && !r.email && !r.whatsapp) descartados.push({ nome: c.nome, motivo: `falha: ${r.erro.slice(0, 120)}` })
        // O ERRO DE QUEM VAI PRA RESERVA TAMBÉM CONTA — 11/09/2026.
        //
        // Este ramo era cego: as duas linhas acima só olham `r.erro` quando o
        // candidato está NA onda, então falha ao gravar um candidato de reserva
        // não aparecia em lugar nenhum — nem em `descartados`, nem no erro da
        // busca. `saida.novos` ainda contava ele como novo, então o rastro dizia
        // "achei 3 novos" com 2 linhas no banco.
        //
        // Não é hipótese: em 11/09 o backfill provou que `status='sugerido'`
        // viola a check constraint da tabela. Enquanto as falhas de canal
        // seguraram `contatados` abaixo da cota, `naOnda` nunca foi falso e o
        // problema não apareceu — ele estava esperando o dia em que a onda
        // enchesse. Agora, se acontecer, sai no rastro em vez de sumir.
        if (!naOnda && r.erro) descartados.push({ nome: c.nome, motivo: `reserva não gravou: ${r.erro.slice(0, 120)}` })
      }
    }
  } catch (err) {
    saida.erro = err instanceof Error ? err.message : String(err)
    console.error('[captacao-pedido] busca falhou', { pedido: pedido.id, erro: saida.erro })
  }

  await supabaseAdmin.from('captacao_buscas').insert({
    pedido_id: pedido.id,
    regiao,
    origem: opts.origem,
    perfil,
    consultas: busca?.consultas ?? [],
    encontrados: saida.encontrados,
    novos: saida.novos,
    contatados: saida.contatados,
    descartados,
    resumo: busca?.resumo ?? null,
    modelo: MODELO,
    tokens_entrada: busca?.tokensEntrada ?? 0,
    tokens_saida: busca?.tokensSaida ?? 0,
    buscas_web: busca?.buscasWeb ?? 0,
    duracao_ms: Date.now() - inicio,
    erro: saida.erro,
  })
  return saida
}

/** O cron: olha os pedidos sem fornecedor e roda a busca de quem está na vez. */
export async function rodarCaptacaoPedidos(origem: 'cron' | 'admin' | 'mcp' = 'cron'): Promise<ResultadoRodada> {
  const { modo, config } = await configCaptacao()
  const resultado: ResultadoRodada = { pedidos_olhados: 0, buscas: [], contatados_hoje_antes: await contatadosHoje(), reabordados: 0, segurados: [], pulado: null }
  if (modo === 'desligado') {
    resultado.pulado = 'agente de captação desligado'
    return resultado
  }
  if (origem === 'cron' && !estaEmHorarioComercial()) {
    resultado.pulado = 'fora do horário comercial'
    return resultado
  }

  // Ordem da vez: ver `ordenarParaAVez`. O filtro de idade continua valendo —
  // pedido além de `idade_max_dias` não entra nem na faixa 1, só pelo "Buscar
  // agora" do admin.
  const limiteIdade = Date.now() - config.idade_max_dias * 86400_000
  const elegiveis = (await pedidosPorEtapa(['sem_fornecedor'], 100))
    .filter((p) => new Date(p.confirmado_em ?? p.desde).getTime() >= limiteIdade)
  const pedidos = ordenarParaAVez(elegiveis, await ultimaBuscaPorPedido(elegiveis.map((p) => p.id)))
  resultado.pedidos_olhados = pedidos.length
  if (modo === 'responde') resultado.reabordados = await reabordarPendentes(pedidos, config)
  let rodadas = 0
  for (const p of pedidos) {
    if (rodadas >= PEDIDOS_POR_RODADA) break
    if (modo === 'responde' && config.max_por_dia - (await contatadosHoje()) <= 0) {
      resultado.pulado = 'teto diário atingido'
      break
    }
    const anteriores = await buscasDoPedido(p.id)
    // Antes: "já fez N buscas, N = número de regiões, para". Com onda de 2 isso
    // abandonava o pedido depois de 6 abordagens mesmo com o estado do cliente
    // cheio de confecção. Agora o que encerra é a região secar, não a contagem.
    if (regioesEsgotadas(anteriores, config.regioes)) continue
    if ((await contatadosDoPedido(p.id)) >= config.max_por_pedido) continue
    // O PORTÃO DA ONDA — 10/09/2026. Manda 2, espera a resposta, só então
    // manda mais 2. Quem já topou segura a fila inteira.
    const onda = await ondaPodeAbrir(p.id, config)
    if (onda.segura) {
      resultado.segurados.push({ pedido: p.codigo ?? p.id, motivo: onda.motivo ?? 'aguardando', contatados: onda.contatados, responderam: onda.responderam })
      continue
    }
    rodadas++
    resultado.buscas.push(await captarParaPedido(p, { origem }))
  }
  return resultado
}

// ─── Quem respondeu: o Luigi em modo captação ───────────────────────────────

export type CandidatoLinha = {
  id: string
  nome: string | null
  email: string | null
  whatsapp: string | null
  pedido_id: string | null
  cidade: string | null
  uf: string | null
  resposta: string | null
  status: string
  ultimo_contato_em: string | null
}

/** Candidato abordado por pedido cujo WhatsApp bate com o wa_id (8 dígitos finais). */
export async function candidatoPeloWaId(waId: string): Promise<CandidatoLinha | null> {
  const last8 = normalizarWaId(waId).slice(-8)
  if (last8.length < 8) return null
  const { data } = await supabaseAdmin
    .from('captacao_fornecedores')
    .select('id, nome, email, whatsapp, pedido_id, cidade, uf, resposta, status, ultimo_contato_em')
    .eq('origem', 'pedido')
    .ilike('whatsapp', `%${last8}`)
    .not('ultimo_contato_em', 'is', null)
    .order('ultimo_contato_em', { ascending: false })
    .limit(1)
    .maybeSingle<CandidatoLinha>()
  return data ?? null
}

export async function registrarRespostaCandidato(id: string, resposta: 'interessado' | 'recusou' | 'depois' | 'nao_produz' | 'opt_out', observacao?: string | null): Promise<void> {
  const agora = new Date().toISOString()
  const fecha = resposta === 'recusou' || resposta === 'nao_produz' || resposta === 'opt_out'
  const { error } = await supabaseAdmin
    .from('captacao_fornecedores')
    .update({
      resposta,
      respondido_em: agora,
      ...(observacao?.trim() ? { resposta_obs: observacao.trim().slice(0, 300) } : {}),
      // Quem não produz, recusou ou pediu pra sair não recebe follow-up.
      ...(fecha ? { status: 'esgotado', proximo_envio_em: null } : {}),
      atualizado_em: agora,
    })
    .eq('id', id)
  if (error) throw new Error(`resposta do candidato: ${error.message}`)
}

type LinhaMensagem = { direcao: string; tipo: string; corpo: string | null; criado_em: string }

async function historicoConversa(conversaId: string): Promise<Anthropic.Messages.MessageParam[]> {
  const { data } = await supabaseAdmin
    .from('wa_mensagens')
    .select('direcao, tipo, corpo, criado_em')
    .eq('conversa_id', conversaId)
    .order('criado_em', { ascending: false })
    .limit(HISTORICO_MENSAGENS)
  const linhas = ((data ?? []) as LinhaMensagem[]).reverse()
  const msgs: Anthropic.Messages.MessageParam[] = []
  for (const m of linhas) {
    const role: 'user' | 'assistant' = m.direcao === 'entrada' ? 'user' : 'assistant'
    const texto = m.corpo?.trim() || `[${m.tipo}]`
    const anterior = msgs[msgs.length - 1]
    if (anterior && anterior.role === role && typeof anterior.content === 'string') anterior.content = `${anterior.content}\n\n${texto}`
    else msgs.push({ role, content: texto })
  }
  if (msgs.length && msgs[0].role !== 'user') msgs.unshift({ role: 'user', content: '[início da conversa]' })
  return msgs
}

function promptCandidato(cand: CandidatoLinha, perfil: PerfilBusca | null, pdfJaEnviado: boolean): string {
  const pedido = perfil
    // SEM PRAZO — 12/09/2026. O prazo do pedido é desejo do cliente, não
    // condição aceita, e dito na abordagem soa combinado. Ele volta na hora do
    // ORÇAMENTO, onde ela assume um número (prazo_producao_dias). A UF fica:
    // sem ela "Jaboatão dos Guararapes" não diz nada pra quem é de outro
    // estado, e a distância é metade da decisão dela.
    ? `${perfil.descricao}, entrega em ${lugarEntrega(perfil)}. Peças: ${perfil.modelos.join(', ')}.${perfil.materiais.length ? ` Materiais: ${perfil.materiais.join(', ')}.` : ''}`
    : 'pedido não encontrado (o Fernando resolve)'
  return `Você é o Luigi, da Confeccione, marketplace que conecta quem precisa produzir roupas a confecções de todo o Brasil (sede em Recife). Está falando pelo WhatsApp oficial com uma CONFECÇÃO que a gente abordou por causa de um pedido sem fornecedor. A abertura foi só "Oi, tudo bem? Aqui é o Luigi, da Confeccione. Gostaria de tirar uma dúvida sobre uma produção com vocês." — então, quando ela responder ("oi", "pode falar", "quem é?"), a sua PRIMEIRA mensagem é a dúvida em si, natural e direta: temos um pedido de X pra entregar em Y, vocês produzem esse tipo de peça nessa quantidade? Não se apresente de novo (o nome já foi dito), não repita a dúvida depois. Se perguntarem o que é a Confeccione: em uma linha, marketplace que traz pedidos de roupa pra confecções, com pagamento garantido e sem custo pra entrar, a plataforma só ganha comissão quando o pedido fecha.

ATUALIZAR O PERFIL DE PRODUÇÃO (quando a conversa for essa). Se a confecção já é cadastrada e o assunto é atualizar o perfil dela, o seu trabalho é uma conversa curta, não um questionário. O que a gente precisa saber, em ordem de importância:

1. o que ela faz — facção pura, ou também corte, modelagem, pilotagem, estamparia, bordado
2. ela fornece o tecido e o aviamento, ou o cliente manda o material
3. que tecido ela trabalha — malha, plana, suplex, moletom, jeans
4. quanto ela dá conta por mês, em peças
5. se ela costuma pegar encaixe (pedido no meio da agenda cheia) — sem cravar prazo mínimo, isso muda toda semana e quem decide é ela quando a oferta chega
6. o que ela NÃO faz — isso vale tanto quanto o resto e quase ninguém pergunta

UMA PERGUNTA POR MENSAGEM, e chame salvar_perfil_producao A CADA resposta, não só no fim. A conversa pode morrer na terceira pergunta, e três respostas gravadas já melhoram o match. Se ela responder duas coisas de uma vez, grave as duas e pule a pergunta que ela já respondeu.

Não faça as seis se ela estiver com pressa: as duas primeiras já valem a conversa. Agradeça e encerre pela porta aberta.

Diga POR QUE está perguntando, uma vez só, no começo: é pra mandar só pedido que combina com ela, em vez de tudo. Isso é verdade e é o que faz ela responder — o benefício é dela.

PEÇA AS FOTOS DEPOIS DO CADASTRO. Confecção cadastrada e sem foto no perfil é um card vazio: o cliente não escolhe quem ele não vê trabalhar. Quando ela se cadastrar, ou quando disser o que produz, peça em uma linha: "manda 3 ou 4 fotos de peças que vocês já fizeram, coloco no perfil de vocês". Ela manda na hora, porque é o que ela já faz o dia inteiro no Instagram. Cada foto que chegar, chame salvar_no_portfolio com uma legenda curta do que é a peça, nas palavras dela.

Não peça foto antes do cadastro (não existe perfil pra guardar), não peça mais de uma vez na mesma conversa, e não insista se ela não mandar — é bônus, o cadastro é o objetivo. Se ela mandar catálogo em PDF ou link do Instagram em vez de foto, agradeça e siga: por enquanto só a foto entra no perfil.

"BOA SORTE" É PROIBIDO, em qualquer forma e em qualquer momento. "Boa sorte pra vocês", "sucesso aí", "espero que dê tudo certo": soa a dispensa educada, como quem já virou as costas. Quem ouve entende que a conversa acabou e que você não quis nada com ela. Se for pra encerrar, encerre pela porta aberta: "Qualquer coisa é só chamar aqui." Nunca deseje sorte pra ninguém.

FALE COMO DONO DE EMPRESA FALA COM DONO DE EMPRESA. Do outro lado tem alguém no meio da produção, com máquina ligada, que decide em cinco segundos se te responde. Frase curta, assunto na primeira linha, uma pergunta só.

NUNCA comece a mensagem repetindo quem você é. "Luigi, da Confeccione. Temos um pedido de 4 polos..." é a máquina se apresentando duas vezes na mesma conversa: a abertura JÁ disse o seu nome. Comece pelo pedido.
NUNCA recite o que você sabe do cadastro dela de volta pra ela. Ela sabe em que polo trabalha; ouvir isso da sua boca soa a lista comprada, não a conversa.
NUNCA escreva travessão, nem "esse tipo de peça nessa quantidade", nem "gostaria de saber se seria possível". Ninguém fala assim no WhatsApp.

Ruim: "Luigi, da Confeccione. Temos um pedido de 4 polos em piquet algodão pra entregar no Rio de Janeiro — vocês produzem esse tipo de peça nessa quantidade?"
Bom: "Temos um pedido de 4 polos em piquet algodão pra entregar no Rio. Vocês fazem?"

Ruim: "Perfeito! Fico muito feliz em saber. Poderia me informar qual seria o prazo estimado de produção?"
Bom: "Boa. Em quanto tempo vocês entregam?"

CONFECÇÃO: ${cand.nome ?? 'sem nome'}${[cand.cidade, cand.uf].filter(Boolean).length ? ` (${[cand.cidade, cand.uf].filter(Boolean).join('/')})` : ''}. Resposta registrada até agora: ${cand.resposta ?? 'nenhuma'}.

O PEDIDO: ${pedido}
${pdfJaEnviado ? 'O resumo em PDF já foi enviado nesta conversa.' : 'O resumo em PDF (sem os dados do cliente) ainda não foi enviado. Ele NÃO é passo obrigatório: mande com enviar_pdf_pedido só se a confecção pedir mais detalhes, ficar em dúvida sobre a peça ou disser que precisa ver melhor pra responder. Mandar PDF antes disso atrasa a conversa e não aproxima do cadastro.'}

COMO FUNCIONA PRA CONFECÇÃO: você cadastra ela AQUI na conversa (não mande link de site), a Confeccione oferece os pedidos que combinam com ela, ela aceita, monta o orçamento pela plataforma e negocia com o cliente por lá. Não passamos o contato do cliente antes disso.

ASSIM QUE ELA DISSER QUE FAZ, diga as DUAS frases abaixo, nesta ordem, LITERAIS, sem parafrasear nenhuma palavra:
"${TEXTO_COMISSAO}"
"${TEXTO_PAGAMENTO_GARANTIA}"
Por que literais: a segunda, parafraseada, vira "eles seguram meu dinheiro" — o contrário do que ela diz. A primeira, parafraseada, perde o número e vira "uma comissão", que é o tipo de vaguidão que ela descobre sozinha depois e passa a desconfiar. Diga as duas de uma vez, aqui, ANTES de ela perguntar: em 10/09 a confecção pediu pix no minuto 19 porque ninguém tinha falado disso.

O CADASTRO É AQUI, NA CONVERSA — 12/09/2026.
Mandar link de formulário no meio da conversa é perder a conversa: quatro confecções disseram que fazem, quatro receberam o link, ZERO se cadastraram. Uma delas chegou a responder "vou pedir pra que o cadastro seja efetuado" e nunca voltou.

A ORDEM (não é script, é ordem — e ela não avança enquanto a anterior não fechar):
1. Você aborda com o pedido.
2. Ela responde se faz ou não.
   • FAZ → registrar_resposta interessado.
   • NÃO FAZ → registrar_resposta nao_produz, e A CONVERSA NÃO ACABOU: um "não" pra esta peça não é um "não" pra plataforma. Siga pro mesmo cadastro, pelo galho (b) das perguntas.
3. RESPONDA O QUE ELA PERGUNTAR, de verdade, até ela não ter mais dúvida. Pergunta técnica sobre o pedido (tem estampa? qual tamanho? é só a camisa?) se responde PRIMEIRO, com a resposta, e NUNCA na mesma mensagem que fala de cadastro. Em 10/09 uma confecção perguntou três vezes "terá bordado?" e levou duas respostas mandando ela ver o PDF e se cadastrar. Ela respondeu, mas não voltou.
4. Só então peça licença: "${FALAS_CADASTRO.licenca}" seguido de "${FALAS_CADASTRO.porque}"
5. Colete conversando, UMA pergunta por mensagem.
6. Confirme e grave com cadastrar_confeccao. E PARA AÍ.

LEIA A CONVERSA ANTES DE PERGUNTAR. Metade do cadastro costuma já ter sido dita: se ela falou que faz camiseta e bordado, já deu prazo ou já citou preço, NÃO PERGUNTE DE NOVO. Perguntar o que a pessoa acabou de responder é o jeito mais rápido de perder ela. Pergunte só o que falta.

AS TRÊS PERGUNTAS, nesta ordem, pulando as que ela já respondeu:
1. PRODUTOS — e a pergunta muda conforme ela fazer ou não a peça do pedido:
   • Ela FAZ: "${FALAS_CADASTRO.produtosFaz}" (troque {peça} pela peça do pedido). A peça do pedido já conta, não precisa ela repetir.
   • Ela NÃO FAZ: "${FALAS_CADASTRO.produtosNaoFaz}" — e a peça do pedido NÃO entra no que ela faz.
   NUNCA sugira uma lista de opções. Existe todo tipo de fornecedor e a lista induz a resposta.
   Mande no campo produtos o que ela disser, NAS PALAVRAS DELA, um item por posição. Quem traduz pro catálogo é a ferramenta.
2. "${FALAS_CADASTRO.cidade}"
3. "${FALAS_CADASTRO.minimo}" — TEM QUE VIR NÚMERO. Se ela disser "depende" ou "a partir de pouquinho": "${FALAS_CADASTRO.minimoAncora}"

TRÊS É O TETO, e prazo NÃO entra. Prazo varia de negociação pra negociação; perguntado aqui vira chute, e ele volta no orçamento como número assumido. Não pergunte CNPJ, dado bancário, faturamento nem nada sensível: isso é do primeiro pagamento.

CONFIRME ANTES DE GRAVAR, sempre, numa mensagem só, no formato:
"${FALAS_CADASTRO.confirmacao}"
Só chame cadastrar_confeccao depois do sim dela, com confirmado_por_ela: true. A ferramenta recusa sem isso — no formulário a pessoa VÊ o que preencheu antes de enviar, e aqui isso só existe se você fizer.

DEPOIS DE GRAVAR, diga LITERAL, conforme o galho:
• Ela faz a peça do pedido: "${FALAS_CADASTRO.prontoFaz}"
• Ela não faz: "${FALAS_CADASTRO.prontoNaoFaz}" — repare que esta NÃO fala da região nem sugere que o pedido de agora vai. Ela disse que não faz; prometer esse pedido é mentir na primeira frase do relacionamento.
NÃO prometa volume nem número de pedidos: são 4 pedidos entregues em 229.

CADASTRAR NÃO É ASSUMIR O PEDIDO — 12/09/2026.
São dois consentimentos diferentes: "pode me cadastrar" e "quero esse pedido". Depois de gravar o cadastro você PARA. NÃO diga que o pedido é dela, NÃO mande os dados do cliente, NÃO prometa que ele vai chegar agora. Assumir a produção é outra conversa, com outra confirmação — o Fernando conduz. Juntar as duas é o atalho que faz a pessoa aceitar o que não leu, e o que ela assume aqui é obrigação de produzir.

NÃO PROMETA SINAL NEM ADIANTAMENTO — 10/09/2026. Existe uma política de liberar o valor no ato em pedidos menores, mas ela vale só pra confecção JÁ VERIFICADA, e quem você está abordando ainda não é. Se ela perguntar de sinal, adiantamento ou "quando eu recebo", responda o que vale aqui: o pagamento fica retido pela plataforma e é repassado depois da entrega. Se ela insistir ou disser que só topa com sinal, chame chamar_humano e PARE — não invente condição pra fechar. Prometer adiantamento a quem ainda não passou pela verificação é o tipo de promessa que a gente descobre que não podia cumprir quando ela já começou a produzir.

QUANDO A CONFECÇÃO DESCONFIAR: é normal ela achar que abordagem por WhatsApp é golpe, ainda mais antes de se cadastrar. Responda com o que dá pra conferir: a Confeccione é empresa de Recife, embarcada no Porto Digital desde 28 de maio de 2026, CNPJ 49.307.439/0001-50, e a página confeccione.com.br/porto-digital explica. Some a isso o que já está no combinado: cadastro sem custo, pagamento retido pela plataforma e repassado depois da entrega, e a gente nunca pede dinheiro dela. Curto, sem defensiva, e volte ao pedido. Não invente prêmio, investidor, número de confecções nem parceria que não esteja escrito aqui.

SEU OBJETIVO É UM SÓ: confecção cadastrada na plataforma. Não é coletar preço, não é mandar PDF, não é conversar bonito — é cadastro. Preço e prazo são conversa boa, mas quem fecha pedido é quem está cadastrado. Se a conversa acabar com a confecção interessada e sem o cadastro feito, você falhou. Mas cadastro se conquista conversando, não atropelando: a pressa que faz você pular pras perguntas cedo demais é a mesma que perde a confecção.

NUNCA PERGUNTE CAPACIDADE PRODUTIVA. Nem "quantas peças vocês fazem por mês", nem "qual a capacidade de vocês", nem "quanto aguentam". A resposta não muda nada: não filtra pedido, não decide quem recebe o quê, e é um número que ela chuta e que estaria errado no mês seguinte. É pergunta que gasta uma rodada da conversa pra não servir pra nada. Se ELA falar o número por conta própria, registre em capacidade_mes e siga — mas nunca puxe o assunto.

UMA PERGUNTA POR MENSAGEM, E ESPERE A RESPOSTA. Esta regra vale mais que a pressa de cadastrar. Não faça a pergunta seguinte antes de ela responder a anterior, e nunca mande duas mensagens seguidas sem ela ter falado no meio. Se ela mandar duas ou três mensagens de uma vez, isso é UMA fala dela: leia tudo junto e responda UMA vez só, não uma resposta por mensagem.

Errado (10/09/2026, conversa real): "E além do corte, vocês fazem algum outro serviço, como costura ou facção?" e, um minuto depois, sem ela ter respondido: "Só corte mesmo, sem costura?". A pessoa ainda estava digitando. Duas perguntas em sequência não aceleram nada — fazem ela responder uma e ignorar a outra, e do lado de lá parece robô com pressa.

NÃO REPITA O QUE VOCÊ ACABOU DE DIZER. Antes de escrever, olhe a sua última mensagem: se for pra dizer a mesma coisa de novo — outro "qualquer coisa é só chamar aqui", outro agradecimento, outro fecho —, não mande nada. Conversa encerrada é pra ficar encerrada; despedir-se três vezes é pior que não se despedir.

NÃO SAIA EXPLICANDO. O bloco "COMO FUNCIONA PRA CONFECÇÃO" acima é o que você SABE, não o que você despeja. Responda só o que ela perguntou, na medida da pergunta. Explicação longa não pedida faz a pessoa parar de ler.

O QUE FAZER, uma etapa por mensagem: (1) explicar a dúvida (o pedido) e perguntar se produzem; (2) quando ela disser que faz (sim, faço, consigo, produzimos, "manda os detalhes") → registrar_resposta interessado e puxe o cadastro. (3) Se ela quiser conversar mais, aí sim prazo e valor por peça, uma pergunta por vez, e o PDF se ela pedir detalhes. Se ela já respondeu preço e prazo sem você pedir, registre e vá pro cadastro, não fique coletando mais dado.

O CADASTRO NÃO É A PRIMEIRA COISA — 10/09/2026, atualizado em 12/09. Antes era um LINK, e ele saía assim que ela dizia "faço", junto com a explicação inteira. Link colado numa pessoa que trocou duas frases com você é panfleto: ela não clica, e a conversa morre ali — 4 de 4 morreram assim. Agora não há link nenhum, o cadastro é aqui; mas a ordem continua valendo. Converse primeiro — entenda o que ela faz, reaja ao que ela contou — e ofereça o cadastro quando ela demonstrar que quer receber pedido, ou quando ELA perguntar como funciona. Aí o cadastro é resposta a uma pergunta dela, e não interrupção. Se ela disser que JÁ É CADASTRADA na Confeccione → não cadastre de novo: registrar_resposta interessado com observação "já cadastrada", chame chamar_humano e pare — o Fernando manda o pedido pela plataforma. Se disser que NÃO PRODUZ ESSE TIPO DE PEÇA, a conversa NÃO acabou — ela está começando. Um "não" pra esta peça não é um "não" pra plataforma: a gente tem pedido de tudo quanto é tipo entrando toda semana, e essa confecção pode ser exatamente quem falta pro pedido da semana que vem. Nessa ordem: (a) pergunte o que ela FAZ — que peças e que serviços, uma coisa por mensagem; (b) registrar_resposta nao_produz com a observação contendo o perfil dela, nas palavras dela; (c) diga que dá pra receber os pedidos que combinam com esse perfil e CADASTRE ELA AQUI, com as três perguntas — nada de link. Só encerre se ela disser que não quer se cadastrar. Nunca responda "boa sorte", "obrigado pela atenção" ou qualquer despedida antes de ter oferecido o cadastro — isso é jogar fora uma confecção que se deu ao trabalho de te responder. Se ela já contou o que faz sem você perguntar, pule o (a): registre e vá pro cadastro. Se não quiser agora ou não tem capacidade → registrar_resposta depois; se não quiser receber mais mensagens → registrar_resposta opt_out e confirme que não mandamos mais. Se perguntarem valor do cliente, contato do cliente, condições que não estão aqui, ou reclamarem → chamar_humano e PARE: não escreva mais nada nessa mensagem. O Fernando recebe o aviso no WhatsApp e continua ele mesmo. Não negocie preço, não prometa volume, não invente número.

ESTILO: WhatsApp, 1 a 4 linhas, sem emoji, sem markdown, sem lista, sem botão, uma pergunta por vez, português direto de gente da equipe. Se perguntarem se você é robô, diga que é o assistente da equipe e que uma pessoa assume quando quiser.`
}

const FERRAMENTAS_CANDIDATO: Anthropic.Messages.Tool[] = [
  {
    name: 'registrar_resposta',
    description: 'Registra o que a confecção respondeu à sondagem.',
    input_schema: {
      type: 'object',
      properties: {
        resposta: {
          type: 'string',
          enum: ['interessado', 'recusou', 'depois', 'nao_produz', 'opt_out'],
          description:
            'nao_produz = não faz ESTA peça (pode fazer outras, e isso vale registrar). recusou = não quer trabalhar com a gente.',
        },
        observacao: {
          type: 'string',
          maxLength: 300,
          description:
            'O PERFIL DELA, nas palavras dela: que peças e serviços faz, quantidade mínima, se fornece tecido, prazo, valor. ' +
            'Isto é o que sobra da conversa — é por aqui que a gente vai saber, no próximo pedido, que essa confecção serve. ' +
            'Ex.: "facção, modelagem e pilotagem; mínimo 15 peças por modelo; não fornece tecido nem aviamento; não faz polo".',
        },
      },
      required: ['resposta'],
    },
  },
  {
    name: 'salvar_perfil_producao',
    description:
      'Grava o que a confecção contou sobre a produção dela. Chame A CADA resposta, não só no fim: ' +
      'a conversa pode parar no meio e três respostas gravadas já melhoram o match. ' +
      'Campo que você não passar fica como estava — nunca some por omissão.',
    input_schema: {
      type: 'object',
      properties: {
        servicos: {
          type: 'array',
          items: { type: 'string', maxLength: 40 },
          description: 'Ex.: ["facção", "corte", "modelagem", "pilotagem", "estamparia", "bordado"].',
        },
        tecidos: {
          type: 'array',
          items: { type: 'string', maxLength: 40 },
          description: 'Ex.: ["malha", "plana", "suplex", "moletom", "jeans"].',
        },
        maquinas: {
          type: 'array',
          items: { type: 'string', maxLength: 40 },
          description: 'Ex.: ["reta", "overloque", "galoneira", "travete"].',
        },
        fornece_material: { type: 'boolean', description: 'true = fornece tecido e aviamento; false = facção pura.' },
        capacidade_mes: { type: 'number', minimum: 1, description: 'Peças por mês, no número que ELA disse.' },
        aceita_encaixe: { type: 'boolean', description: 'Pega pedido no meio da agenda cheia?' },
        faz_desenvolvimento: { type: 'boolean', description: 'Desenvolve peça a partir de foto, sem molde pronto?' },
        prazo_minimo_dias: { type: 'number', minimum: 1, maximum: 180, description: 'Prazo mínimo que ela aceita.' },
        nao_faz: { type: 'string', maxLength: 200, description: 'O que ela NÃO faz. Vale tanto quanto o que faz.' },
        observacao: { type: 'string', maxLength: 300 },
      },
    },
  },
  {
    name: 'salvar_no_portfolio',
    description:
      'Guarda no portfólio da confecção a última foto que ELA mandou nesta conversa. Use quando ela mandar foto de peça que produz. ' +
      'Só funciona depois que ela está cadastrada — antes disso não existe portfólio pra guardar.',
    input_schema: {
      type: 'object',
      properties: {
        legenda: {
          type: 'string',
          maxLength: 120,
          description: 'O que é a peça, nas palavras dela. Ex.: "legging suplex cintura alta".',
        },
      },
    },
  },
  {
    name: 'enviar_pdf_pedido',
    description: 'Manda nesta conversa o resumo do pedido em PDF (sem nome nem contato do cliente).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'cadastrar_confeccao',
    description:
      'Cria o cadastro da confecção AQUI na conversa, sem site. Só depois de ela dizer que faz, de você ' +
      'ter respondido o que ela perguntou, e de ela CONFIRMAR o resumo do que você entendeu.',
    input_schema: {
      type: 'object',
      properties: {
        produtos: {
          type: 'array',
          items: { type: 'string' },
          description:
            'O que ela disse que faz, NAS PALAVRAS DELA, um item por posição ("camiseta", "bordado em peça pronta"). ' +
            'Não traduza pro catálogo: quem traduz é a ferramenta.',
        },
        cidade: { type: 'string' },
        estado: { type: 'string', description: 'UF, duas letras.' },
        pedido_minimo: { type: 'number', description: 'NÚMERO de peças. "depende" não serve.' },
        email: { type: 'string' },
        confirmado_por_ela: {
          type: 'boolean',
          description:
            'true SÓ se você repetiu o resumo numa mensagem e ela respondeu confirmando. ' +
            'Sem isso a ferramenta recusa.',
        },
      },
      required: ['cidade', 'estado', 'pedido_minimo', 'confirmado_por_ela'],
    },
  },
  {
    name: 'chamar_humano',
    description: 'Passa a conversa pra uma pessoa da equipe (valor do cliente, contato do cliente, reclamação, condição fora do combinado).',
    input_schema: { type: 'object', properties: { motivo: { type: 'string', minLength: 3, maxLength: 200 } }, required: ['motivo'] },
  },
]

function textoDaResposta(content: Anthropic.Messages.ContentBlock[]): string {
  return content.filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim()
}

function paraWhatsApp(texto: string): string {
  return (
    texto
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/^\s*[-•*]\s+/gm, '')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
      // Travessão é marca de texto escrito, não de conversa: ninguém digita "—"
      // no WhatsApp. Aqui virava "4 polos em piquet — vocês produzem?", que
      // denuncia máquina na primeira linha. Mesma limpeza que o Luigi já faz do
      // lado do cliente.
      .replace(/\s*[—–]\s*/g, ', ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 1500)
  )
}

async function enviarPdfNaConversa(waId: string, nome: string | null, pedidoId: string): Promise<boolean> {
  const pdf = await pdfSondagem(pedidoId)
  if (!pdf) return false
  const arquivo = pdf.bytes.buffer.slice(pdf.bytes.byteOffset, pdf.bytes.byteOffset + pdf.bytes.byteLength) as ArrayBuffer
  const up = await uploadMidia(arquivo, 'application/pdf', pdf.nomeArquivo)
  if (!up.ok) return false
  const legenda = 'Resumo do pedido, sem os dados do cliente.'
  const r = await enviarMidiaPorId(waId, 'document', up.mediaId, { caption: legenda, filename: pdf.nomeArquivo })
  if (!r.ok) return false
  await registrarSaidaInbox(waId, nome, r.wamid, `📄 ${pdf.nomeArquivo} — ${legenda}`, null, 'luigi')
  return true
}

/**
 * Chamada pelo Luigi (responderCliente) quando o contato é um candidato
 * abordado por pedido. Responde dentro da janela (ele acabou de escrever).
 * Devolve true se tratou a mensagem.
 */
export async function responderCandidato(params: {
  conversaId: string
  waId: string
  nome: string | null
  wamid: string
  corpo: string | null
  candidato: CandidatoLinha
}): Promise<boolean> {
  const { modo } = await configCaptacao()
  if (modo !== 'responde') return false
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return false
  const waId = normalizarWaId(params.waId)
  const texto = (params.corpo ?? '').trim()
  if (!texto) return true // mídia sem texto: fica pra gente, mas não é cliente

  const cand = params.candidato
  const pedido = cand.pedido_id ? await pedidoEtapa(cand.pedido_id).catch(() => null) : null
  const perfil = pedido ? perfilDeBusca(pedido, await prazoDoPedido(pedido.id)) : null
  const { data: docs } = await supabaseAdmin
    .from('wa_mensagens')
    .select('id')
    .eq('conversa_id', params.conversaId)
    .eq('direcao', 'saida')
    .eq('autor', 'luigi')
    .ilike('corpo', '%sondagem-%')
    .limit(1)
  let pdfJaEnviado = (docs ?? []).length > 0

  const client = new Anthropic({ apiKey })
  const historico = await historicoConversa(params.conversaId)
  if (!historico.length || historico[historico.length - 1].role !== 'user') historico.push({ role: 'user', content: texto })

  let resposta = ''
  let escalada: string | null = null
  let rodadas = 0
  while (rodadas < MAX_RODADAS_RESPOSTA) {
    rodadas++
    const r = await client.messages.create({
      model: MODELO,
      max_tokens: MAX_TOKENS_RESPOSTA,
      system: promptCandidato(cand, perfil, pdfJaEnviado),
      tools: FERRAMENTAS_CANDIDATO,
      messages: historico,
    })
    void registrarUsoIa('captacao-resposta', MODELO, r.usage)
    const parcial = textoDaResposta(r.content)
    if (parcial) resposta = parcial
    const usos = r.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use')
    if (r.stop_reason !== 'tool_use' || usos.length === 0) break
    historico.push({ role: 'assistant', content: r.content })
    const resultados: Anthropic.Messages.ToolResultBlockParam[] = []
    for (const uso of usos) {
      const entrada = (uso.input ?? {}) as Record<string, unknown>
      try {
        if (uso.name === 'registrar_resposta') {
          const v = str(entrada.resposta)
          if (v !== 'interessado' && v !== 'recusou' && v !== 'depois' && v !== 'nao_produz' && v !== 'opt_out') throw new Error('resposta inválida')
          await registrarRespostaCandidato(cand.id, v, str(entrada.observacao))
          if (v === 'interessado') {
            await marcarEscalada(params.conversaId)
            await avisarGestor(`Captação: ${cand.nome ?? waId} respondeu SIM pro pedido ${pedido?.codigo ?? cand.pedido_id ?? ''}${str(entrada.observacao) ? ` — ${str(entrada.observacao)}` : ''}. Falta aprovar o cadastro e ofertar (/admin/whatsapp).`)
          }
          resultados.push({ type: 'tool_result', tool_use_id: uso.id, content: JSON.stringify({ ok: true, resposta: v }) })
        } else if (uso.name === 'salvar_perfil_producao') {
          const { data: c } = await supabaseAdmin
            .from('wa_contatos')
            .select('fornecedor_id')
            .eq('wa_id', waId)
            .maybeSingle<{ fornecedor_id: string | null }>()

          if (!c?.fornecedor_id) {
            resultados.push({
              type: 'tool_result',
              tool_use_id: uso.id,
              content: JSON.stringify({
                ok: false,
                aviso: 'Essa confecção ainda não tem cadastro — sem cadastro não há perfil pra preencher. Mande o link primeiro.',
              }),
            })
          } else {
            const lista = (v: unknown) =>
              Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 20) : null
            const bool = (v: unknown) => (typeof v === 'boolean' ? v : null)
            // O `num` daqui exige padrão e faixa; aqui ausência precisa virar
            // null, não um valor inventado — perfil pela metade é esperado.
            const inteiro = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null)
            try {
              const salvo = await salvarPerfil(c.fornecedor_id, {
                servicos: lista(entrada.servicos),
                tecidos: lista(entrada.tecidos),
                maquinas: lista(entrada.maquinas),
                forneceMaterial: bool(entrada.fornece_material),
                capacidadeMes: inteiro(entrada.capacidade_mes),
                aceitaEncaixe: bool(entrada.aceita_encaixe),
                fazDesenvolvimento: bool(entrada.faz_desenvolvimento),
                prazoMinimoDias: inteiro(entrada.prazo_minimo_dias),
                naoFaz: str(entrada.nao_faz),
                observacao: str(entrada.observacao),
              })
              resultados.push({ type: 'tool_result', tool_use_id: uso.id, content: JSON.stringify({ ok: true, perfil: salvo }) })
            } catch (e) {
              resultados.push({
                type: 'tool_result',
                tool_use_id: uso.id,
                content: JSON.stringify({ ok: false, erro: e instanceof Error ? e.message : 'falha ao gravar' }),
              })
            }
          }
        } else if (uso.name === 'salvar_no_portfolio') {
          // O fornecedor_id vem do contato do WhatsApp, não do que o modelo
          // diz: portfólio é dado de cadastro e não pode depender de o agente
          // ter guardado o id certo na cabeça.
          const { data: contato } = await supabaseAdmin
            .from('wa_contatos')
            .select('fornecedor_id')
            .eq('wa_id', waId)
            .maybeSingle<{ fornecedor_id: string | null }>()

          if (!contato?.fornecedor_id) {
            resultados.push({
              type: 'tool_result',
              tool_use_id: uso.id,
              content: JSON.stringify({
                ok: false,
                aviso:
                  'Essa confecção ainda não tem cadastro, então não existe portfólio pra guardar a foto. ' +
                  'Agradeça a foto, diga que ela aparece no perfil assim que o cadastro sair, e mande o link.',
              }),
            })
          } else {
            // A última FOTO que ELA mandou. Imagem que saiu daqui não entra.
            const { data: foto } = await supabaseAdmin
              .from('wa_mensagens')
              .select('midia_path, midia_mime')
              .eq('conversa_id', params.conversaId)
              .eq('direcao', 'entrada')
              .eq('tipo', 'image')
              .not('midia_path', 'is', null)
              .order('criado_em', { ascending: false })
              .limit(1)
              .maybeSingle<{ midia_path: string | null }>()

            if (!foto?.midia_path) {
              resultados.push({
                type: 'tool_result',
                tool_use_id: uso.id,
                content: JSON.stringify({ ok: false, aviso: 'Não achei foto nenhuma mandada por ela nesta conversa.' }),
              })
            } else {
              try {
                await salvarFotoDaConversa(contato.fornecedor_id, foto.midia_path, str(entrada.legenda))
                resultados.push({ type: 'tool_result', tool_use_id: uso.id, content: JSON.stringify({ ok: true }) })
              } catch (e) {
                resultados.push({
                  type: 'tool_result',
                  tool_use_id: uso.id,
                  content: JSON.stringify({ ok: false, erro: e instanceof Error ? e.message : 'falha ao guardar' }),
                })
              }
            }
          }
        } else if (uso.name === 'enviar_pdf_pedido') {
          // UMA VEZ POR CONVERSA, TRAVADO AQUI — 12/09/2026.
          //
          // Em 10/09 o mesmo PDF saiu TRÊS vezes pra Bordado Mágico (09:14:55,
          // 09:15:55, 09:17:56). A única contenção era uma linha de prompt
          // dizendo "o resumo em PDF já foi enviado nesta conversa" — e o
          // `pdfJaEnviado` que a alimenta existia desde 07/09, três dias antes.
          // O prompt avisou e o modelo mandou assim mesmo.
          //
          // É a regra do AGENTS.md ao pé da letra: efeito de ferramenta se trava
          // DENTRO da ferramenta. A recusa devolve o que fazer em seguida, não
          // um erro — a conversa continua, ela só não leva a terceira cópia.
          if (pdfJaEnviado) {
            resultados.push({
              type: 'tool_result',
              tool_use_id: uso.id,
              content: JSON.stringify({
                ok: false,
                aviso: 'O PDF já foi enviado nesta conversa. Não mande de novo: responda a dúvida dela com palavras.',
              }),
            })
            continue
          }
          const ok = cand.pedido_id ? await enviarPdfNaConversa(waId, params.nome ?? cand.nome, cand.pedido_id) : false
          if (ok) pdfJaEnviado = true
          resultados.push({ type: 'tool_result', tool_use_id: uso.id, content: JSON.stringify({ ok, aviso: ok ? 'PDF enviado nesta conversa.' : 'Não deu pra mandar o PDF agora; diga que manda em seguida.' }) })
        } else if (uso.name === 'cadastrar_confeccao') {
          const r = await cadastrarConfeccaoDaConversa(cand, entrada, waId, params.nome)
          if (r.ok && r.pendente) escalada = 'confecção faz algo fora do catálogo de peças — confira o cadastro'
          resultados.push({ type: 'tool_result', tool_use_id: uso.id, content: JSON.stringify(r) })
        } else if (uso.name === 'chamar_humano') {
          escalada = str(entrada.motivo) ?? 'confecção precisa de uma pessoa'
          resultados.push({ type: 'tool_result', tool_use_id: uso.id, content: JSON.stringify({ ok: true }) })
        } else {
          resultados.push({ type: 'tool_result', tool_use_id: uso.id, content: `Erro: ferramenta desconhecida ${uso.name}`, is_error: true })
        }
      } catch (err) {
        resultados.push({ type: 'tool_result', tool_use_id: uso.id, content: `Erro: ${err instanceof Error ? err.message : String(err)}`, is_error: true })
      }
    }
    historico.push({ role: 'user', content: resultados })
  }

  // Escalou: quem fala em seguida é o Fernando, pelo inbox.
  if (!resposta && !escalada) resposta = ''
  resposta = paraWhatsApp(resposta)
  void marcarComoLida(params.wamid).catch(() => false)

  // ---------------------------------------------------- não fale duas vezes
  // DUAS MENSAGENS DELA VIRAVAM DUAS RESPOSTAS NOSSAS — 10/09/2026.
  //
  // Quem escreve no WhatsApp quebra o pensamento em balões: o Ademilson mandou
  // "Tecido plano" e, no mesmo minuto, "Corta o biquíni corto viscose suplex".
  // São duas linhas de UMA fala — mas cada uma acordou uma rodada, e o Luigi
  // respondeu as duas: perguntou o serviço às 09:16 e, sem ela ter dito nada no
  // meio, perguntou de novo às 09:17. Com a Bordado Mágico deu no mesmo: ela
  // agradeceu em duas mensagens e levou quatro despedidas quase idênticas.
  //
  // A regra no prompt ("uma pergunta por mensagem") não segura isto, porque as
  // duas rodadas são processos separados — cada uma acha que está falando pela
  // primeira vez. A trava tem que ser aqui, olhando o que JÁ SAIU: se a gente
  // escreveu depois que esta mensagem chegou, a rodada é velha e o que ela tem
  // a dizer já foi dito. Cala.
  //
  // Mesma lição do PDF que saiu três vezes pro Julio em 09/09: efeito de envio
  // se trava no ponto do envio, não no prompt.
  const { data: nossaUltima } = await supabaseAdmin
    .from('wa_mensagens')
    .select('corpo, criado_em')
    .eq('conversa_id', params.conversaId)
    .eq('direcao', 'saida')
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle<{ corpo: string | null; criado_em: string }>()

  const { data: entradaAtual } = await supabaseAdmin
    .from('wa_mensagens')
    .select('criado_em')
    .eq('wamid', params.wamid)
    .maybeSingle<{ criado_em: string }>()

  if (nossaUltima && entradaAtual && new Date(nossaUltima.criado_em) > new Date(entradaAtual.criado_em)) {
    console.log(`[captacao] rodada velha em ${params.conversaId}: já respondemos depois desta mensagem, calando`)
    return true
  }

  // E não repita o que você acabou de dizer. Fecho é o caso clássico ("qualquer
  // coisa é só chamar aqui"): a conversa acabou, e cada mensagem nova dela
  // arranca outro fecho igual. Comparação frouxa de propósito — o modelo varia
  // a pontuação e a primeira palavra, não a frase.
  const normalizar = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9 ]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  if (resposta && nossaUltima?.corpo) {
    const a = normalizar(resposta)
    const b = normalizar(nossaUltima.corpo)
    if (a.length > 0 && (a === b || (a.length > 25 && (b.includes(a) || a.includes(b))))) {
      console.log(`[captacao] resposta repetida em ${params.conversaId}, calando: "${resposta.slice(0, 60)}"`)
      return true
    }
  }

  if (resposta && (await janela24hAberta(waId))) {
    const envio = await enviarTexto(waId, resposta)
    if (envio.ok) await registrarSaidaInbox(waId, params.nome ?? cand.nome, envio.wamid, resposta, null, 'luigi')
  }
  if (escalada) {
    await marcarEscalada(params.conversaId)
    await avisarGestor(`Captação: ${cand.nome ?? waId} — ${escalada}. Responde pelo inbox (/admin/whatsapp).`)
  }
  return true
}

// ─── Leitura pro admin ──────────────────────────────────────────────────────

export type BuscaResumo = {
  id: string
  criado_em: string
  pedido_id: string
  regiao: RegiaoBusca
  origem: string
  encontrados: number
  novos: number
  contatados: number
  resumo: string | null
  erro: string | null
  consultas: string[]
  descartados: Array<{ nome: string; motivo: string }>
  perfil: Partial<PerfilBusca>
}

export async function buscasRecentes(limite = 30): Promise<BuscaResumo[]> {
  const { data } = await supabaseAdmin
    .from('captacao_buscas')
    .select('id, criado_em, pedido_id, regiao, origem, encontrados, novos, contatados, resumo, erro, consultas, descartados, perfil')
    .order('criado_em', { ascending: false })
    .limit(limite)
  return (data ?? []) as unknown as BuscaResumo[]
}

export async function candidatosPorPedido(pedidoIds: string[]): Promise<Record<string, CandidatoLinha[]>> {
  const out: Record<string, CandidatoLinha[]> = {}
  if (pedidoIds.length === 0) return out
  const { data } = await supabaseAdmin
    .from('captacao_fornecedores')
    .select('id, nome, email, whatsapp, pedido_id, cidade, uf, resposta, status, ultimo_contato_em, instagram, site, evidencia, ultimo_erro')
    .in('pedido_id', pedidoIds)
    .order('criado_em', { ascending: false })
  for (const c of (data ?? []) as unknown as CandidatoLinha[]) {
    if (!c.pedido_id) continue
    ;(out[c.pedido_id] ??= []).push(c)
  }
  return out
}
