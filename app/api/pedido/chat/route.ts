// app/api/pedido/chat/route.ts
// ============================================================================
// POST /api/pedido/chat — captação de pedido via chat com IA (backend).
//
// Server-side only. Stateless: o histórico inteiro vem no body a cada chamada.
// O modelo responde SOMENTE com JSON (contrato abaixo); a rota faz parse
// defensivo (stripa cercas de código, valida com zod) e, se falhar, devolve
// uma pergunta de fallback preservando o estado anterior do pedido.
//
// NÃO coleta nome/whatsapp/email (contato é etapa separada — commit 3) e NÃO
// persiste nada. A criação do pedido continua em /api/pedidos/criar.
//
// Fonte única dos segmentos: SEGMENTOS_CAPTACAO (captacao-templates.ts) — o
// campo `tipo` só pode ser um dos ids de lá.
// ============================================================================

import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { SEGMENTOS_CAPTACAO } from '@/app/lib/captacao-templates'

export const runtime = 'nodejs'

const MODELO = 'claude-sonnet-4-6'
const MAX_TOKENS = 700
const TEMPERATURE = 0.4
const MAX_MENSAGENS = 24

const IDS_SEGMENTO = new Set(SEGMENTOS_CAPTACAO.map((s) => s.id))

// ----------------------------------------------------------------------------
// Contrato de saída (o que a rota devolve pro cliente)
// ----------------------------------------------------------------------------
type Pedido = {
  tipo: string | null
  quantidade: number | null
  estado: string | null
  prazo: string | null
  descricao: string | null
}

const PEDIDO_VAZIO: Pedido = {
  tipo: null,
  quantidade: null,
  estado: null,
  prazo: null,
  descricao: null,
}

const PERGUNTA_FALLBACK =
  'Desculpa, me perdi aqui. Pode me contar de novo o que você precisa produzir?'

// ----------------------------------------------------------------------------
// Schemas zod
// ----------------------------------------------------------------------------
const MensagemSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
})

const BodySchema = z.object({
  messages: z.array(MensagemSchema),
})

// Parse TOLERANTE da resposta do modelo: um campo torto não derruba o turno
// inteiro — vira null. `mensagem` é o único campo realmente obrigatório.
const quantidadeTolerante = z.preprocess((v) => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}, z.number().nullable()).catch(null)

const PedidoModeloSchema = z
  .object({
    tipo: z.string().nullable().catch(null),
    quantidade: quantidadeTolerante,
    estado: z.string().nullable().catch(null),
    prazo: z.string().nullable().catch(null),
    descricao: z.string().nullable().catch(null),
  })
  .catch({ ...PEDIDO_VAZIO })

const RespostaModeloSchema = z.object({
  mensagem: z.string().min(1),
  pedido: PedidoModeloSchema.default({ ...PEDIDO_VAZIO }),
})

// ----------------------------------------------------------------------------
// System prompt (pt-BR)
// ----------------------------------------------------------------------------
const LISTA_SEGMENTOS = SEGMENTOS_CAPTACAO.map(
  (s) => `- ${s.nome} (id: ${s.id}) — ex.: ${s.exemplos}`
).join('\n')

const SYSTEM_PROMPT = `Você é o assistente de captação de pedidos da Confeccione, plataforma que conecta quem precisa fabricar roupa a confecções. Seu único objetivo é entender o pedido do cliente e montar a especificação.

Converse de forma simples, calorosa e objetiva, em português do Brasil, uma pergunta por vez. Descubra: tipo de peça, quantidade, estado (UF) e prazo; e qualquer detalhe útil para a descrição. Se o cliente descrever algo fora dos segmentos, pergunte para esclarecer e mapeie para o mais próximo.

Mapeie o tipo de peça para um destes segmentos (use exatamente o id):
${LISTA_SEGMENTOS}

Nunca peça nome, telefone ou e-mail — o contato é uma etapa posterior. Não fale de outros assuntos além do pedido de confecção.

A cada resposta, devolva SOMENTE um JSON válido (sem markdown, sem cercas de código, sem texto fora dele) neste formato exato:
{"mensagem": string, "pedido": {"tipo": string|null, "quantidade": number|null, "estado": string|null, "prazo": string|null, "descricao": string|null}, "completo": boolean}

Regras do JSON:
- "mensagem" é o que você fala com o cliente (a próxima pergunta ou a confirmação).
- "tipo" deve ser exatamente um dos ids acima, ou null se ainda não dá pra determinar.
- "quantidade" é um número (peças), ou null.
- "estado" é a sigla da UF (ex.: "PE", "SP"), ou null.
- "prazo" é o prazo desejado em texto livre, ou null.
- "descricao" reúne detalhes úteis (tecido, cor, estampa, modelagem…), ou null.
- "completo" é true SOMENTE quando tipo, quantidade, estado e prazo estiverem todos preenchidos.`

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/** Remove cercas de código e texto fora do objeto JSON, se vierem. */
function extrairJson(bruto: string): string {
  let s = bruto.trim()
  // remove ```json ... ``` ou ``` ... ```
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  // se ainda houver texto em volta, fica só do primeiro { ao último }
  const ini = s.indexOf('{')
  const fim = s.lastIndexOf('}')
  if (ini !== -1 && fim !== -1 && fim > ini) {
    s = s.slice(ini, fim + 1)
  }
  return s
}

/** Concatena os blocos de texto da resposta do modelo. */
function textoDaResposta(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
}

/** Último `pedido` válido já produzido pelo assistente no histórico. Como a
 *  rota é stateless, o "estado anterior" é reconstruído do próprio histórico. */
function pedidoAnterior(
  messages: Array<{ role: string; content: string }>
): Pedido {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'assistant') continue
    try {
      const obj = JSON.parse(extrairJson(m.content))
      const r = RespostaModeloSchema.safeParse(obj)
      if (r.success) return normalizarPedido(r.data.pedido)
    } catch {
      // ignora mensagens do assistente que não sejam JSON
    }
  }
  return { ...PEDIDO_VAZIO }
}

/** Aplica as invariantes do contrato: tipo ∈ segmentos (senão null). */
function normalizarPedido(p: Pedido): Pedido {
  const tipo = p.tipo && IDS_SEGMENTO.has(p.tipo) ? p.tipo : null
  const estado = p.estado ? p.estado.trim().toUpperCase().slice(0, 2) || null : null
  return { ...p, tipo, estado }
}

/** completo = tipo + quantidade + estado + prazo todos preenchidos. Recalculado
 *  no servidor, independente do que o modelo afirmar. */
function calcularCompleto(p: Pedido): boolean {
  return Boolean(p.tipo && p.quantidade && p.estado && p.prazo)
}

// ----------------------------------------------------------------------------
// Handler
// ----------------------------------------------------------------------------
export async function POST(req: Request) {
  // Body
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

  // Guardrail de tamanho do histórico
  if (messages.length > MAX_MENSAGENS) {
    return NextResponse.json(
      { error: `Histórico longo demais (máx. ${MAX_MENSAGENS} mensagens).` },
      { status: 400 }
    )
  }

  // Env
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[pedido/chat] ANTHROPIC_API_KEY ausente no ambiente')
    return NextResponse.json(
      { error: 'Serviço de chat indisponível no momento.' },
      { status: 500 }
    )
  }

  const anterior = pedidoAnterior(messages)

  // Chamada ao modelo — await ANTES de qualquer return (serverless encerra no return)
  let texto: string
  try {
    const client = new Anthropic({ apiKey })
    const resposta = await client.messages.create({
      model: MODELO,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    })
    texto = textoDaResposta(resposta.content)
  } catch (err) {
    console.error('[pedido/chat] falha na chamada ao modelo:', err)
    return NextResponse.json(
      { error: 'Não consegui responder agora. Tente de novo.' },
      { status: 502 }
    )
  }

  // Parse defensivo da resposta do modelo
  let parsed: z.infer<typeof RespostaModeloSchema> | null = null
  try {
    const obj = JSON.parse(extrairJson(texto))
    const r = RespostaModeloSchema.safeParse(obj)
    if (r.success) parsed = r.data
  } catch {
    parsed = null
  }

  if (!parsed) {
    // Fallback: preserva o estado anterior, pede esclarecimento.
    return NextResponse.json({
      mensagem: PERGUNTA_FALLBACK,
      pedido: anterior,
      completo: calcularCompleto(anterior),
    })
  }

  const pedido = normalizarPedido(parsed.pedido)
  return NextResponse.json({
    mensagem: parsed.mensagem,
    pedido,
    completo: calcularCompleto(pedido),
  })
}
