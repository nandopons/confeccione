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
import { registrarUsoIa } from './uso-ia'
import { pedidosPorEtapa, pedidoEtapa, type PedidoEtapa } from './etapas-pedido'
import { normalizarWaId, enviarTemplate, enviarTexto, enviarMidiaPorId, uploadMidia, marcarComoLida } from './whatsapp-cloud'
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

/** Template aprovado na Meta pra sondagem fria; sem ele, só e-mail sai. */
export const TEMPLATE_SONDAGEM = process.env.WHATSAPP_TEMPLATE_SONDAGEM || ''

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
  if (nacional.length === 11 && nacional[2] === '9') return { whatsapp: normalizarWaId(nacional), telefone: null }
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

async function motivoParaDescartar(c: Candidato): Promise<MotivoDescarte | null> {
  const last8 = c.whatsapp?.slice(-8) ?? c.telefone?.slice(-8) ?? null
  if (!last8 && !c.email) return 'sem_contato_util'

  if (last8 || c.email) {
    let q = supabaseAdmin.from('leads_fornecedores').select('id').limit(1)
    q = last8 && c.email ? q.or(`whatsapp.ilike.%${last8},email.ilike.${c.email}`) : last8 ? q.ilike('whatsapp', `%${last8}`) : q.ilike('email', c.email!)
    const { data } = await q
    if (data && data.length) return 'ja_fornecedor'
  }

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

export function textoSondagemWhatsApp(perfil: PerfilBusca, nomeConfeccao: string | null): string {
  const oi = nomeConfeccao ? `Oi, ${nomeConfeccao}.` : 'Oi.'
  return `${oi} Aqui é o Luigi, da Confeccione, em Recife. Temos um pedido de ${perfil.descricao} pra entregar em ${lugarEntrega(perfil)}${perfil.prazoDias ? `, prazo de ${perfil.prazoDias} dias` : ''}. Vocês produzem esse tipo de peça nessa quantidade? Se sim, respondo aqui com o resumo em PDF.`
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
    if (!TEMPLATE_SONDAGEM) {
      whatsapp = false
      erros.push('whatsapp: template de sondagem não configurado (WHATSAPP_TEMPLATE_SONDAGEM)')
    } else {
      const r = await enviarTemplate(c.whatsapp, TEMPLATE_SONDAGEM, 'pt_BR', [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: (c.nome || 'pessoal').slice(0, 60) },
            { type: 'text', text: perfil.descricao.slice(0, 120) },
            { type: 'text', text: lugarEntrega(perfil).slice(0, 60) },
          ],
        },
      ])
      whatsapp = r.ok
      if (r.ok) await registrarSaidaInbox(c.whatsapp, c.nome, r.wamid, textoSondagemWhatsApp(perfil, c.nome), TEMPLATE_SONDAGEM, 'luigi')
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
  pulado: string | null
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
    for (const c of busca.candidatos) {
      if (saida.contatados >= cota && enviar) break
      const motivo = await motivoParaDescartar(c)
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
  const resultado: ResultadoRodada = { pedidos_olhados: 0, buscas: [], contatados_hoje_antes: await contatadosHoje(), pulado: null }
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
  return `Você é o Luigi, da Confeccione, marketplace que conecta quem precisa produzir roupas a confecções de todo o Brasil (sede em Recife). Está falando pelo WhatsApp oficial com uma CONFECÇÃO que a gente abordou por causa de um pedido sem fornecedor. Você já se apresentou na primeira mensagem; não se apresente de novo.

CONFECÇÃO: ${cand.nome ?? 'sem nome'}${[cand.cidade, cand.uf].filter(Boolean).length ? ` (${[cand.cidade, cand.uf].filter(Boolean).join('/')})` : ''}. Resposta registrada até agora: ${cand.resposta ?? 'nenhuma'}.

O PEDIDO: ${pedido}
${pdfJaEnviado ? 'O resumo em PDF já foi enviado nesta conversa.' : 'O resumo em PDF (sem os dados do cliente) ainda não foi enviado: mande com enviar_pdf_pedido assim que a confecção mostrar interesse ou pedir detalhes.'}

COMO FUNCIONA PRA CONFECÇÃO: ela se cadastra na plataforma (${URL_CADASTRO_FORNECEDOR}, cinco minutos), a Confeccione aprova o cadastro e oferece o pedido; ela aceita, monta o orçamento pela plataforma e negocia com o cliente por lá; o cliente paga à Confeccione, o pagamento fica retido e é repassado depois da entrega. A Confeccione fica com uma comissão sobre o valor fechado. Não passamos o contato do cliente antes disso.

O QUE FAZER: se ela disser que produz (sim, faz, consegue, manda os detalhes) → registrar_resposta interessado, mandar o PDF se ainda não foi, e dizer o próximo passo em uma linha (cadastro pelo link; depois de aprovado o pedido chega pra ela lá). Pergunte, uma coisa por vez, o que ajuda a fechar: prazo que conseguem e valor aproximado por peça. Se disser que não produz esse tipo de peça → registrar_resposta nao_produz e agradeça em uma linha; se não quiser agora ou não tem capacidade → registrar_resposta depois; se não quiser receber mais mensagens → registrar_resposta opt_out e confirme que não mandamos mais. Se perguntarem valor do cliente, contato do cliente, condições que não estão aqui, ou reclamarem → chamar_humano e diga que alguém da equipe continua. Não negocie preço, não prometa volume, não invente número.

ESTILO: WhatsApp, 1 a 4 linhas, sem emoji, sem markdown, sem lista, sem botão, uma pergunta por vez, português direto de gente da equipe. Se perguntarem se você é robô, diga que é o assistente da equipe e que uma pessoa assume quando quiser.`
}

const FERRAMENTAS_CANDIDATO: Anthropic.Messages.Tool[] = [
  {
    name: 'registrar_resposta',
    description: 'Registra o que a confecção respondeu à sondagem.',
    input_schema: {
      type: 'object',
      properties: {
        resposta: { type: 'string', enum: ['interessado', 'recusou', 'depois', 'nao_produz', 'opt_out'] },
        observacao: { type: 'string', maxLength: 300, description: 'Prazo, valor aproximado, capacidade, o que ela disse.' },
      },
      required: ['resposta'],
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
  return texto
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\s*[-•*]\s+/gm, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 1500)
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

  if (!resposta) resposta = 'Vou pedir pra alguém da equipe continuar com você por aqui.'
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
