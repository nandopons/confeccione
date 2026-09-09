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
import { pedidosPorEtapa, pedidoEtapa, type PedidoEtapa } from './etapas-pedido'
import { normalizarWaId, enviarTemplate, enviarTexto, enviarMidiaPorId, uploadMidia, marcarComoLida, listarTemplates } from './whatsapp-cloud'
import { consultarTemplatesWhatsApp } from './whatsapp-templates'
import { janela24hAberta, registrarSaidaInbox } from './whatsapp-notify'
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
  max_por_pedido: number
  max_por_dia: number
  regioes: RegiaoBusca[]
  horas_entre_buscas: number
  /** Pedido sem fornecedor há mais que isso (dias) o cron não busca sozinho — só pelo "Buscar agora". */
  idade_max_dias: number
}

const CONFIG_PADRAO: ConfigCaptacao = { max_por_pedido: 10, max_por_dia: 40, regioes: REGIOES, horas_entre_buscas: 48, idade_max_dias: 21 }

function num(v: unknown, padrao: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : padrao
  return Math.min(Math.max(Math.round(n), min), max)
}

export async function configCaptacao(): Promise<{ modo: ModoLuigi; config: ConfigCaptacao }> {
  const { data } = await supabaseAdmin
    .from('agentes_config')
    .select('modo, config')
    .eq('agente', 'captacao')
    .maybeSingle<{ modo: string; config: Record<string, unknown> | null }>()
  const c = data?.config ?? {}
  const regioes = Array.isArray(c.regioes) ? (c.regioes as unknown[]).filter((r): r is RegiaoBusca => REGIOES.includes(r as RegiaoBusca)) : REGIOES
  return {
    modo: ehModoLuigi(data?.modo) ? data.modo : 'desligado',
    config: {
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

/** Celular brasileiro (11 dígitos com 9) vira wa_id; fixo fica só como telefone. */
function telefoneParaWaId(v: string | null): { whatsapp: string | null; telefone: string | null } {
  if (!v) return { whatsapp: null, telefone: null }
  const dig = v.replace(/\D/g, '').replace(/^0+/, '')
  if (dig.length < 10) return { whatsapp: null, telefone: null }
  const nacional = dig.startsWith('55') && dig.length >= 12 ? dig.slice(2) : dig
  if (nacional.length === 11 && nacional[2] === '9') return { whatsapp: `55${nacional}`, telefone: null }
  // Celular no formato antigo (DDD + 8 dígitos começando em 6–9): site desatualizado.
  // Fixo começa em 2–5, então não há ambiguidade — entra o nono dígito.
  if (nacional.length === 10 && /[6-9]/.test(nacional[2])) return { whatsapp: `55${nacional.slice(0, 2)}9${nacional.slice(2)}`, telefone: null }
  if (nacional.length === 10 || nacional.length === 11) return { whatsapp: null, telefone: nacional }
  return { whatsapp: null, telefone: null }
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

export async function contatadosHoje(): Promise<number> {
  const { count } = await supabaseAdmin
    .from('captacao_fornecedores')
    .select('id', { count: 'exact', head: true })
    .eq('origem', 'pedido')
    .gte('ultimo_contato_em', inicioDoDiaRecife())
  return count ?? 0
}

async function contatadosDoPedido(pedidoId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from('captacao_fornecedores')
    .select('id', { count: 'exact', head: true })
    .eq('pedido_id', pedidoId)
    .not('ultimo_contato_em', 'is', null)
  return count ?? 0
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
  const { data: linha, error } = await supabaseAdmin
    .from('captacao_fornecedores')
    .insert({
      nome: c.nome,
      email: c.email,
      whatsapp: c.whatsapp ?? c.telefone,
      segmento: perfil.segmento,
      etapa: 0,
      status: enviar ? 'ativo' : 'sugerido',
      canal_email: Boolean(c.email),
      canal_whatsapp: Boolean(c.whatsapp),
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
  return await enviarSondagem(linha.id, c, perfil, pdf)
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
      const r = await enviarTemplate(c.whatsapp, TEMPLATE_SONDAGEM, IDIOMA_TEMPLATE_SONDAGEM, [
        { type: 'body', parameters: [{ type: 'text', text: (c.nome || 'pessoal').slice(0, 60) }] },
      ])
      whatsapp = r.ok
      if (r.ok) await registrarSaidaInbox(c.whatsapp, c.nome, r.wamid, textoSondagemWhatsApp(c.nome), TEMPLATE_SONDAGEM, 'luigi')
      else erros.push(`whatsapp: ${r.erro}`)
    }
  }

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

async function buscasDoPedido(pedidoId: string): Promise<Array<{ regiao: RegiaoBusca; criado_em: string }>> {
  const { data } = await supabaseAdmin.from('captacao_buscas').select('regiao, criado_em').eq('pedido_id', pedidoId).order('criado_em', { ascending: false }).limit(10)
  return (data ?? []) as Array<{ regiao: RegiaoBusca; criado_em: string }>
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
  const regiao: RegiaoBusca = opts.regiao ?? config.regioes[Math.min(anteriores.length, config.regioes.length - 1)]
  const saida = { pedido: pedido.codigo ?? pedido.id, regiao, encontrados: 0, novos: 0, contatados: 0, erro: null as string | null }

  const jaContatados = await contatadosDoPedido(pedido.id)
  const restanteDoPedido = config.max_por_pedido - jaContatados
  const restanteDoDia = config.max_por_dia - (await contatadosHoje())
  const enviar = modo === 'responde'
  const cota = enviar ? Math.max(0, Math.min(restanteDoPedido, restanteDoDia)) : Math.max(0, restanteDoPedido)
  if (cota === 0 && !opts.forcar) {
    saida.erro = restanteDoPedido <= 0 ? 'teto por pedido atingido' : 'teto diário atingido'
    return saida
  }

  const perfil = perfilDeBusca(pedido, await prazoDoPedido(pedido.id))
  let busca: ResultadoBusca | null = null
  const descartados: Array<{ nome: string; motivo: string }> = []
  try {
    busca = await descobrirCandidatos(perfil, regiao, Math.min(Math.max(cota, 5), 15))
    saida.encontrados = busca.candidatos.length
    const pdf = enviar ? await pdfSondagem(pedido.id).catch(() => null) : null
    const base = await carregarBaseFornecedores()
    for (const c of busca.candidatos) {
      if (saida.contatados >= cota && enviar) break
      const motivo = await motivoParaDescartar(c, base)
      if (motivo) {
        descartados.push({ nome: c.nome, motivo })
        continue
      }
      saida.novos++
      const r = await abordarCandidato(c, perfil, enviar, pdf)
      if (enviar && (r.email || r.whatsapp)) saida.contatados++
      if (r.erro && !r.email && !r.whatsapp) descartados.push({ nome: c.nome, motivo: `falha: ${r.erro.slice(0, 120)}` })
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
  const resultado: ResultadoRodada = { pedidos_olhados: 0, buscas: [], contatados_hoje_antes: await contatadosHoje(), reabordados: 0, pulado: null }
  if (modo === 'desligado') {
    resultado.pulado = 'agente de captação desligado'
    return resultado
  }
  if (origem === 'cron' && !estaEmHorarioComercial()) {
    resultado.pulado = 'fora do horário comercial'
    return resultado
  }

  // Do mais recente pro mais antigo: pedido novo sem confecção é o que tem
  // cliente esperando; os velhos só pelo "Buscar agora" do admin.
  const limiteIdade = Date.now() - config.idade_max_dias * 86400_000
  const pedidos = (await pedidosPorEtapa(['sem_fornecedor'], 100))
    .filter((p) => new Date(p.confirmado_em ?? p.desde).getTime() >= limiteIdade)
    .sort((a, b) => (b.confirmado_em ?? b.desde).localeCompare(a.confirmado_em ?? a.desde))
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
    if (anteriores.length >= config.regioes.length) continue
    const ultima = anteriores[0]
    if (ultima && Date.now() - new Date(ultima.criado_em).getTime() < config.horas_entre_buscas * 3600_000) continue
    if ((await contatadosDoPedido(p.id)) >= config.max_por_pedido) continue
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
    ? `${perfil.descricao}, entrega em ${lugarEntrega(perfil)}${perfil.prazoDias ? `, prazo desejado de ${perfil.prazoDias} dias` : ''}. Peças: ${perfil.modelos.join(', ')}.${perfil.materiais.length ? ` Materiais: ${perfil.materiais.join(', ')}.` : ''}`
    : 'pedido não encontrado (o Fernando resolve)'
  return `Você é o Luigi, da Confeccione, marketplace que conecta quem precisa produzir roupas a confecções de todo o Brasil (sede em Recife). Está falando pelo WhatsApp oficial com uma CONFECÇÃO que a gente abordou por causa de um pedido sem fornecedor. A abertura foi só "Oi, tudo bem? Aqui é o Luigi, da Confeccione. Gostaria de tirar uma dúvida sobre uma produção com vocês." — então, quando ela responder ("oi", "pode falar", "quem é?"), a sua PRIMEIRA mensagem é a dúvida em si, natural e direta: temos um pedido de X pra entregar em Y, vocês produzem esse tipo de peça nessa quantidade? Não se apresente de novo (o nome já foi dito), não repita a dúvida depois. Se perguntarem o que é a Confeccione: em uma linha, marketplace que traz pedidos de roupa pra confecções, com pagamento garantido e sem custo pra entrar, a plataforma só ganha comissão quando o pedido fecha.

ATUALIZAR O PERFIL DE PRODUÇÃO (quando a conversa for essa). Se a confecção já é cadastrada e o assunto é atualizar o perfil dela, o seu trabalho é uma conversa curta, não um questionário. O que a gente precisa saber, em ordem de importância:

1. o que ela faz — facção pura, ou também corte, modelagem, pilotagem, estamparia, bordado
2. ela fornece o tecido e o aviamento, ou o cliente manda o material
3. que tecido ela trabalha — malha, plana, suplex, moletom, jeans
4. quanto ela dá conta por mês, em peças
5. prazo mínimo que ela aceita, e se pega encaixe (pedido no meio da agenda cheia)
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

COMO FUNCIONA PRA CONFECÇÃO: ela se cadastra na plataforma (${URL_CADASTRO_FORNECEDOR}, cinco minutos), a Confeccione aprova o cadastro e oferece o pedido; ela aceita, monta o orçamento pela plataforma e negocia com o cliente por lá; o cliente paga à Confeccione, o pagamento fica retido e é repassado depois da entrega. A Confeccione fica com uma comissão sobre o valor fechado. Não passamos o contato do cliente antes disso.

QUANDO A CONFECÇÃO DESCONFIAR: é normal ela achar que abordagem por WhatsApp é golpe, ainda mais antes de se cadastrar. Responda com o que dá pra conferir: a Confeccione é empresa de Recife, embarcada no Porto Digital desde 28 de maio de 2026, CNPJ 49.307.439/0001-50, e a página confeccione.com.br/porto-digital explica. Some a isso o que já está no combinado: cadastro sem custo, pagamento retido pela plataforma e repassado depois da entrega, e a gente nunca pede dinheiro dela. Curto, sem defensiva, e volte ao pedido. Não invente prêmio, investidor, número de confecções nem parceria que não esteja escrito aqui.

SEU OBJETIVO É UM SÓ: confecção cadastrada na plataforma. Não é coletar preço, não é mandar PDF, não é conversar bonito — é cadastro. Preço e prazo são conversa boa, mas quem fecha pedido é quem está cadastrado. Se a conversa acabar com a confecção interessada e sem o link do cadastro enviado, você falhou.

O QUE FAZER, uma etapa por mensagem: (1) explicar a dúvida (o pedido) e perguntar se produzem; (2) ASSIM QUE ELA DISSER QUE FAZ (sim, faço, consigo, produzimos, "manda os detalhes") → registrar_resposta interessado e, na mesma mensagem, chamar pro cadastro: diga que pra receber esse pedido — e os próximos com o perfil dela — ela precisa se cadastrar, e mande ${URL_CADASTRO_FORNECEDOR}. O gancho é esse: não é um pedido avulso, é entrar na base e receber os que combinam com ela. (3) Depois disso, se ela quiser conversar mais, aí sim puxe prazo e valor por peça, uma pergunta por vez, e mande o PDF se ela pedir detalhes. Se ela já respondeu preço e prazo sem você pedir, ótimo — registre e vá direto ao cadastro, não fique coletando mais dado. Não espere ela perguntar como funciona pra mandar o link. Se ela disser que JÁ É CADASTRADA na Confeccione → não mande o link do cadastro: registrar_resposta interessado com observação "já cadastrada", chame chamar_humano e pare — o Fernando manda o pedido pela plataforma. Se disser que NÃO PRODUZ ESSE TIPO DE PEÇA, a conversa NÃO acabou — ela está começando. Um "não" pra esta peça não é um "não" pra plataforma: a gente tem pedido de tudo quanto é tipo entrando toda semana, e essa confecção pode ser exatamente quem falta pro pedido da semana que vem. Nessa ordem: (a) pergunte o que ela FAZ — que peças, que serviços, quantidade mínima; (b) registrar_resposta nao_produz com a observação contendo o perfil dela, nas palavras dela; (c) diga que dá pra receber os pedidos que combinam com esse perfil e mande ${URL_CADASTRO_FORNECEDOR}. Só encerre se ela disser que não quer se cadastrar. Nunca responda "boa sorte", "obrigado pela atenção" ou qualquer despedida antes de ter oferecido o cadastro — isso é jogar fora uma confecção que se deu ao trabalho de te responder. Se ela já contou o que faz sem você perguntar, pule o (a): registre e vá pro cadastro. Se não quiser agora ou não tem capacidade → registrar_resposta depois; se não quiser receber mais mensagens → registrar_resposta opt_out e confirme que não mandamos mais. Se perguntarem valor do cliente, contato do cliente, condições que não estão aqui, ou reclamarem → chamar_humano e PARE: não escreva mais nada nessa mensagem. O Fernando recebe o aviso no WhatsApp e continua ele mesmo. Não negocie preço, não prometa volume, não invente número.

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
          const ok = cand.pedido_id ? await enviarPdfNaConversa(waId, params.nome ?? cand.nome, cand.pedido_id) : false
          if (ok) pdfJaEnviado = true
          resultados.push({ type: 'tool_result', tool_use_id: uso.id, content: JSON.stringify({ ok, aviso: ok ? 'PDF enviado nesta conversa.' : 'Não deu pra mandar o PDF agora; diga que manda em seguida.' }) })
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
  if (await janela24hAberta(waId)) {
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
