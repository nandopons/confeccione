// app/api/pedido/assistente/route.ts
// ============================================================================
// POST /api/pedido/assistente — captação de pedido via chat assistido (Etapa 1).
//
// Server-side only. Stateless: o histórico inteiro vem no body a cada chamada.
// O modelo é o OPERADOR e responde SOMENTE com JSON (contrato abaixo). A rota
// faz parse defensivo (stripa cercas, valida com zod) e, em falha, devolve uma
// pergunta de fallback preservando o estado anterior do pedido.
//
// Modelo de dados: multi-linha. Cada LINHA é um produto homogêneo:
//   { modelo, cor, material, total, tamanhos:[{tamanho,qtd}], descricao }
// Cores diferentes => linhas diferentes. Depois das linhas, coleta CONTATO
// (nome, telefone, email, cep, complemento), uma pergunta por vez.
//
// NÃO persiste nada — a gravação acontece em /api/pedido/assistente/criar
// quando o fluxo fica completo.
// ============================================================================

import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { validarWhatsApp, normalizarWhatsApp } from '@/app/lib/phone'

export const runtime = 'nodejs'

const MODELO = 'claude-sonnet-4-6'
const MAX_TOKENS = 1300
const TEMPERATURE = 0.4
const JANELA_MODELO = 60 // últimas N mensagens enviadas ao modelo (chat ilimitado p/ o cliente)

// ----------------------------------------------------------------------------
// Tipos do contrato
// ----------------------------------------------------------------------------
type Tamanho = { tamanho: string; qtd: number | null }
type Linha = {
  modelo: string | null
  cor: string | null
  material: string | null
  total: number | null
  tamanhos: Tamanho[]
  estampado: boolean | null
  descricao: string | null
}
type Contato = {
  nome: string | null
  telefone: string | null
  email: string | null
  cep: string | null
  complemento: string | null
  logradouro: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
}
type Pedido = { linhas: Linha[]; contato: Contato }

const CONTATO_VAZIO: Contato = { nome: null, telefone: null, email: null, cep: null, complemento: null, logradouro: null, bairro: null, cidade: null, uf: null }
const PEDIDO_VAZIO: Pedido = { linhas: [], contato: { ...CONTATO_VAZIO } }

const PERGUNTA_FALLBACK =
  'Desculpa, me perdi aqui. Pode me contar de novo o que você precisa produzir? (modelo, cor e quantidade)'

// ----------------------------------------------------------------------------
// Schemas zod (parse tolerante: um campo torto vira null, não derruba o turno)
// ----------------------------------------------------------------------------
const numTolerante = z.preprocess((v) => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}, z.number().nullable()).catch(null)

const TamanhoSchema = z.object({
  tamanho: z.string().catch(''),
  qtd: numTolerante,
}).catch({ tamanho: '', qtd: null })

const LinhaSchema = z.object({
  modelo: z.string().nullable().catch(null),
  cor: z.string().nullable().catch(null),
  material: z.string().nullable().catch(null),
  total: numTolerante,
  tamanhos: z.array(TamanhoSchema).catch([]),
  estampado: z.boolean().nullable().catch(null),
  descricao: z.string().nullable().catch(null),
}).catch({ modelo: null, cor: null, material: null, total: null, tamanhos: [], estampado: null, descricao: null })

const ContatoSchema = z.object({
  nome: z.string().nullable().catch(null),
  telefone: z.string().nullable().catch(null),
  email: z.string().nullable().catch(null),
  cep: z.string().nullable().catch(null),
  complemento: z.string().nullable().catch(null),
  logradouro: z.string().nullable().catch(null),
  bairro: z.string().nullable().catch(null),
  cidade: z.string().nullable().catch(null),
  uf: z.string().nullable().catch(null),
}).catch({ ...CONTATO_VAZIO })

const PedidoModeloSchema = z.object({
  linhas: z.array(LinhaSchema).catch([]),
  contato: ContatoSchema.default({ ...CONTATO_VAZIO }),
}).catch({ ...PEDIDO_VAZIO })

const RespostaModeloSchema = z.object({
  mensagem: z.string().min(1),
  pedido: PedidoModeloSchema.default({ ...PEDIDO_VAZIO }),
})

const MensagemSchema = z.object({ role: z.enum(['user', 'assistant']), content: z.string() })
const BodySchema = z.object({ messages: z.array(MensagemSchema) })

// ----------------------------------------------------------------------------
// System prompt (pt-BR) — o assistente é a BALIZA do pedido
// ----------------------------------------------------------------------------
const SYSTEM_PROMPT = `Você é o assistente de pedidos da Confeccione, plataforma que conecta quem precisa fabricar roupa a confecções. Seu trabalho é GUIAR o cliente a montar o pedido dele, do jeito certo, conversando de forma simples, calorosa e objetiva, em português do Brasil. UMA pergunta por vez (nunca despeje várias perguntas juntas) — o site não pode ter fricção, senão o cliente desiste.

VOCÊ É A BALIZA. O cliente quase nunca dá todos os detalhes sozinho. Ex.: "quero uma camisa de algodão estampada" não basta. Você precisa puxar, com naturalidade e uma pergunta por vez: o MODELO (tshirt, oversized, regata, polo, moletom, boné, bolsa…), a COR, o MATERIAL/tecido, a QUANTIDADE total e a divisão por TAMANHO, e detalhes da estampa/arte (onde vai: frente, costas, manga; bordado ou estampa). Não invente dados: se não sabe, pergunte.

ESTRUTURA POR LINHA DE PRODUTO. Cada "linha" é um produto homogêneo: mesmo modelo, mesma cor, mesmo material. Regras:
- Se o cliente quer a MESMA peça em CORES diferentes, isso vira LINHAS diferentes (ex.: 10 pretas + 10 azuis = 2 linhas).
- Para cada linha, descubra: modelo, cor, material, quantidade total, a divisão por tamanho e SE A PEÇA É LISA, ESTAMPADA OU BORDADA. Pergunte isso com naturalidade ("Essa peça vai ser lisa, estampada ou bordada?") — é importante porque MUDA O PREÇO. Preencha "estampado": true quando for estampada OU bordada, e false quando for lisa. Guarde em "descricao" os detalhes (estampa ou bordado, posição: frente/costas/manga, arte própria etc.).
- Para os tamanhos: pergunte primeiro QUANTAS peças no total dessa linha, depois quantas de cada tamanho (P, M, G, GG, etc.). Confira se a soma dos tamanhos bate com o total; se não bater, avise gentil e ajuste.
- Quando uma linha ficar completa, pergunte se ele quer adicionar outro produto/cor ou se o pedido está completo.

FLUXO EM DUAS FASES:
1) PRODUTO: monte as linhas até o cliente dizer que terminou de descrever os produtos.
2) CONTATO: só depois das linhas, colete os dados de contato, UMA pergunta por vez, NESTA ordem: nome, telefone (WhatsApp), e-mail, CEP, complemento (número/apto/referência). Não peça contato antes de ter pelo menos uma linha minimamente completa.

REGRAS DE CONFIABILIDADE DO CONTATO:
- TELEFONE (WhatsApp): exija SEMPRE com DDD. Se o cliente mandar um número curto/sem DDD ou claramente incompleto, NÃO aceite — peça com gentileza o WhatsApp COM DDD (ex.: (81) 99999-9999) e só avance quando tiver DDD. Confirme repetindo o número formatado.
- CEP: peça só o CEP (8 dígitos). O sistema preenche o endereço automaticamente (rua, bairro, cidade/UF) — você NÃO precisa perguntar rua/bairro/cidade. Quando o endereço aparecer no resumo, confirme rapidinho ("É na [rua], [bairro], [cidade]/[UF]?") e pergunte só o NÚMERO e complemento (apto/referência). Se o CEP não trouxer endereço, peça o CEP de novo ou o endereço manualmente.

Quando tudo estiver coletado (linhas + contato), faça uma confirmação curta e simpática do resumo e diga que ele já pode prosseguir para ver a pré-visualização dos produtos.

A cada resposta, devolva SOMENTE um JSON válido (sem markdown, sem cercas de código, sem texto fora dele), com o PEDIDO INTEIRO e atualizado neste formato exato:
{"mensagem": string, "pedido": {"linhas": [{"modelo": string|null, "cor": string|null, "material": string|null, "total": number|null, "tamanhos": [{"tamanho": string, "qtd": number|null}], "estampado": boolean|null, "descricao": string|null}], "contato": {"nome": string|null, "telefone": string|null, "email": string|null, "cep": string|null, "complemento": string|null}}}

Regras do JSON:
- "mensagem" é só o que você fala com o cliente (a próxima pergunta ou a confirmação). Nunca coloque JSON dentro da mensagem.
- Devolva SEMPRE o pedido completo com TODAS as linhas já coletadas (não só a última) e o contato preenchido até aqui.
- "modelo" em texto livre e minúsculo (ex.: "tshirt", "oversized", "polo", "boné"). "cor" e "material" em texto livre.
- "total" é a quantidade de peças daquela linha. "tamanhos" é a divisão (cada item {tamanho, qtd}); se ainda não sabe, deixe [].
- "estampado" é booleano: true se a peça é estampada ou bordada, false se lisa, null se ainda não perguntou. Isso define a faixa de preço (liso vs estampado).
- "descricao" guarda detalhes úteis da linha: estampa/bordado, posição da arte (frente/costas/manga), observações.
- Campos que você ainda não perguntou ficam null. Não preencha contato com placeholders.`

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function extrairJson(bruto: string): string {
  let s = bruto.trim()
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const ini = s.indexOf('{')
  const fim = s.lastIndexOf('}')
  if (ini !== -1 && fim !== -1 && fim > ini) s = s.slice(ini, fim + 1)
  return s
}

function textoDaResposta(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
}

function normalizarPedido(p: Pedido): Pedido {
  const linhas = (p.linhas ?? [])
    .map((l) => ({
      modelo: l.modelo ? l.modelo.trim() || null : null,
      cor: l.cor ? l.cor.trim() || null : null,
      material: l.material ? l.material.trim() || null : null,
      total: typeof l.total === 'number' && l.total > 0 ? Math.round(l.total) : null,
      tamanhos: (l.tamanhos ?? [])
        .map((t) => ({ tamanho: (t.tamanho ?? '').trim(), qtd: typeof t.qtd === 'number' && t.qtd > 0 ? Math.round(t.qtd) : null }))
        .filter((t) => t.tamanho.length > 0),
      estampado: typeof l.estampado === 'boolean' ? l.estampado : null,
      descricao: l.descricao ? l.descricao.trim() || null : null,
    }))
    .filter((l) => l.modelo || l.cor || l.material || l.total || l.tamanhos.length > 0 || l.descricao)
  const c = p.contato ?? { ...CONTATO_VAZIO }
  const norm = (v: string | null) => (v && v.trim() ? v.trim() : null)
  const contato: Contato = {
    nome: norm(c.nome),
    telefone: norm(c.telefone),
    email: norm(c.email),
    cep: norm(c.cep),
    complemento: norm(c.complemento),
    logradouro: norm(c.logradouro),
    bairro: norm(c.bairro),
    cidade: norm(c.cidade),
    uf: norm(c.uf),
  }
  return { linhas, contato }
}

function linhaCompleta(l: Linha): boolean {
  return Boolean(l.modelo && l.cor && l.total)
}

function telefoneValido(t: string | null): boolean {
  // Exige WhatsApp brasileiro com DDD (celular). validarWhatsApp normaliza pra
  // 55+DDD+9+8díg; número sem DDD não passa.
  return Boolean(t && validarWhatsApp(t))
}

// Enriquece o endereço a partir do CEP (ViaCEP). Idempotente: roda sempre que
// houver CEP de 8 dígitos; sobrescreve logradouro/bairro/cidade/uf com a fonte
// oficial. Não toca em complemento (número/apto, que é do cliente).
async function enriquecerEndereco(p: Pedido): Promise<Pedido> {
  const cep = p.contato.cep
  if (!cep) return p
  const digs = cep.replace(/\D/g, '')
  if (digs.length !== 8) return p
  try {
    const r = await fetch(`https://viacep.com.br/ws/${digs}/json/`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    })
    if (!r.ok) return p
    const j = (await r.json()) as {
      erro?: boolean
      logradouro?: string
      bairro?: string
      localidade?: string
      uf?: string
    }
    if (j.erro) return p
    return {
      ...p,
      contato: {
        ...p.contato,
        logradouro: j.logradouro?.trim() || p.contato.logradouro,
        bairro: j.bairro?.trim() || p.contato.bairro,
        cidade: j.localidade?.trim() || p.contato.cidade,
        uf: j.uf?.trim() || p.contato.uf,
      },
    }
  } catch {
    return p
  }
}

function calcularFase(p: Pedido): 'produto' | 'contato' | 'completo' {
  const temLinha = p.linhas.length > 0 && p.linhas.some(linhaCompleta)
  if (!temLinha) return 'produto'
  const c = p.contato
  const contatoOk = Boolean(c.nome && telefoneValido(c.telefone) && c.email && c.cep)
  return contatoOk ? 'completo' : 'contato'
}

function pedidoAnterior(messages: Array<{ role: string; content: string }>): Pedido {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'assistant') continue
    try {
      const obj = JSON.parse(extrairJson(m.content))
      const r = RespostaModeloSchema.safeParse(obj)
      if (r.success) return normalizarPedido(r.data.pedido)
    } catch {
      // ignora
    }
  }
  return { linhas: [], contato: { ...CONTATO_VAZIO } }
}

// ----------------------------------------------------------------------------
// Handler
// ----------------------------------------------------------------------------
export async function POST(req: Request) {
  let bodyBruto: unknown
  try {
    bodyBruto = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido no corpo.' }, { status: 400 })
  }

  const body = BodySchema.safeParse(bodyBruto)
  if (!body.success) {
    return NextResponse.json(
      { error: 'Formato esperado: { messages: [{ role, content }, ...] }' },
      { status: 400 }
    )
  }

  const { messages } = body.data

  // Chat ilimitado pro cliente: em vez de barrar históricos longos, mandamos só
  // as últimas JANELA_MODELO mensagens ao modelo (o pedido inteiro é
  // reconstruído do último JSON do assistente, então não perdemos estado).
  // Garante que a janela comece num turno de 'user' (exigência da API).
  const janela = messages.slice(-JANELA_MODELO)
  while (janela.length && janela[0].role === 'assistant') janela.shift()

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[pedido/assistente] ANTHROPIC_API_KEY ausente')
    return NextResponse.json({ error: 'Serviço de chat indisponível no momento.' }, { status: 500 })
  }

  const anterior = pedidoAnterior(messages)

  let texto: string
  try {
    const client = new Anthropic({ apiKey })
    const resposta = await client.messages.create({
      model: MODELO,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: janela.map((m) => ({ role: m.role, content: m.content })),
    })
    texto = textoDaResposta(resposta.content)
  } catch (err) {
    console.error('[pedido/assistente] falha na chamada ao modelo:', err)
    return NextResponse.json({ error: 'Não consegui responder agora. Tente de novo.' }, { status: 502 })
  }

  let parsed: z.infer<typeof RespostaModeloSchema> | null = null
  try {
    const obj = JSON.parse(extrairJson(texto))
    const r = RespostaModeloSchema.safeParse(obj)
    if (r.success) parsed = r.data
  } catch {
    parsed = null
  }

  if (!parsed) {
    const anteriorEnriq = await enriquecerEndereco(anterior)
    const faseAnt = calcularFase(anteriorEnriq)
    return NextResponse.json({
      mensagem: PERGUNTA_FALLBACK,
      pedido: anteriorEnriq,
      fase: faseAnt,
      completo: faseAnt === 'completo',
    })
  }

  const pedido = await enriquecerEndereco(normalizarPedido(parsed.pedido))
  const fase = calcularFase(pedido)
  return NextResponse.json({
    mensagem: parsed.mensagem,
    pedido,
    fase,
    completo: fase === 'completo',
  })
}
