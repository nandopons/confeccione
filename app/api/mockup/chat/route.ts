// app/api/mockup/chat/route.ts
// ============================================================================
// POST /api/mockup/chat — conversa de IA (Claude) que ajuda o cliente a montar
// o mockup e VAI CONSTRUINDO o prompt de geração de imagem.
//
// Stateless: o histórico inteiro vem no body. O modelo responde SOMENTE com
// JSON (contrato abaixo). Parse defensivo com zod; em falha, devolve uma
// pergunta de fallback. NÃO gera imagem (isso é /api/mockup/gerar) e NÃO
// persiste nada.
// ============================================================================

import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { z } from 'zod'

export const runtime = 'nodejs'

const MODELO = 'claude-sonnet-4-6'
const MAX_TOKENS = 800
const TEMPERATURE = 0.5
const MAX_MENSAGENS = 30

type Brief = {
  peca: string | null
  cor: string | null
  posicao_arte: string | null
  tamanho_arte: string | null
  estilo_foto: string | null
  observacoes: string | null
}

const BRIEF_VAZIO: Brief = {
  peca: null,
  cor: null,
  posicao_arte: null,
  tamanho_arte: null,
  estilo_foto: null,
  observacoes: null,
}

const PERGUNTA_FALLBACK =
  'Desculpa, me perdi aqui. Me conta de novo: qual peça você quer ver com a sua arte?'

const MensagemSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
})

const BodySchema = z.object({
  messages: z.array(MensagemSchema),
  // o cliente já anexou uma logo/arte? ajuda o modelo a saber se pode finalizar.
  temLogo: z.boolean().optional().default(false),
})

const BriefSchema = z
  .object({
    peca: z.string().nullable().catch(null),
    cor: z.string().nullable().catch(null),
    posicao_arte: z.string().nullable().catch(null),
    tamanho_arte: z.string().nullable().catch(null),
    estilo_foto: z.string().nullable().catch(null),
    observacoes: z.string().nullable().catch(null),
  })
  .catch({ ...BRIEF_VAZIO })

const RespostaModeloSchema = z.object({
  mensagem: z.string().min(1),
  brief: BriefSchema.default({ ...BRIEF_VAZIO }),
  prompt_imagem: z.string().nullable().catch(null),
  pronto: z.boolean().catch(false),
})

const SYSTEM_PROMPT = `Você é o assistente do "Monte seu mockup" da Confeccione, plataforma que conecta quem precisa fabricar roupa a confecções. Seu papel é ajudar o cliente a visualizar a arte/logomarca dele numa peça (qualquer item: camiseta, moletom, boné, bolsa, mochila, ecobag, etc.) e, conversando, MONTAR um bom prompt para um modelo de geração de imagem.

Converse em português do Brasil, de forma calorosa e objetiva, UMA pergunta por vez. Baliza a conversa para descobrir, aos poucos: (1) qual peça, (2) cor da peça, (3) onde a arte/logo vai (ex.: peito esquerdo, centro do peito, nas costas, bolso, frente do boné), (4) tamanho da arte (pequena/média/grande), (5) estilo da foto (estúdio fundo neutro, lifestyle/pessoa usando, ou flat-lay). Aceite QUALQUER peça que o cliente pedir. Se faltar a arte/logo, lembre gentilmente que ele pode anexar o arquivo no botão de upload.

Quando tiver o suficiente (pelo menos peça + cor + posição) E o cliente já tiver anexado a arte, defina "pronto": true e escreva um "prompt_imagem" EXCELENTE, em INGLÊS, descrevendo um mockup fotorrealista de produto: a peça, cor, material/textura, a arte/logo aplicada na posição e tamanho combinados, o estilo de foto, fundo, iluminação e enquadramento. SEMPRE inclua a instrução de preservar a logo/arte EXATAMENTE como foi enviada, sem redesenhar nem distorcer (ex.: "place the user's provided logo exactly as given, do not redraw or alter it"). Antes de estar pronto, mantenha "pronto": false e "prompt_imagem": null.

Não fale de assuntos fora do mockup/produção de roupa. Não peça nome, telefone nem e-mail.

A cada resposta, devolva SOMENTE um JSON válido (sem markdown, sem cercas de código, sem texto fora dele) neste formato exato:
{"mensagem": string, "brief": {"peca": string|null, "cor": string|null, "posicao_arte": string|null, "tamanho_arte": string|null, "estilo_foto": string|null, "observacoes": string|null}, "prompt_imagem": string|null, "pronto": boolean}

Regras:
- "mensagem" é o que você fala com o cliente (próxima pergunta, sugestão, ou confirmação de que dá pra gerar).
- "brief" acumula o que já foi definido (mantenha os valores anteriores e só atualize o que mudou).
- "prompt_imagem" só é preenchido quando "pronto" for true.`

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

function briefAnterior(messages: Array<{ role: string; content: string }>): Brief {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'assistant') continue
    try {
      const obj = JSON.parse(extrairJson(m.content))
      const r = RespostaModeloSchema.safeParse(obj)
      if (r.success) return r.data.brief
    } catch {
      // ignora
    }
  }
  return { ...BRIEF_VAZIO }
}

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
      { error: 'Formato esperado: { messages: [{ role, content }], temLogo? }' },
      { status: 400 }
    )
  }

  const { messages, temLogo } = body.data
  if (messages.length > MAX_MENSAGENS) {
    return NextResponse.json(
      { error: `Histórico longo demais (máx. ${MAX_MENSAGENS} mensagens).` },
      { status: 400 }
    )
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[mockup/chat] ANTHROPIC_API_KEY ausente no ambiente')
    return NextResponse.json({ error: 'Serviço de chat indisponível no momento.' }, { status: 500 })
  }

  const anterior = briefAnterior(messages)
  const systemSuffix = temLogo
    ? '\n\nContexto atual: o cliente JÁ anexou a arte/logo.'
    : '\n\nContexto atual: o cliente ainda NÃO anexou a arte/logo — lembre-o de anexar antes de gerar.'

  let texto: string
  try {
    const client = new Anthropic({ apiKey })
    const resposta = await client.messages.create({
      model: MODELO,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: [
        { type: 'text', text: SYSTEM_PROMPT + systemSuffix, cache_control: { type: 'ephemeral' } },
      ],
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    })
    texto = textoDaResposta(resposta.content)
  } catch (err) {
    console.error('[mockup/chat] falha na chamada ao modelo:', err)
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
    return NextResponse.json({
      mensagem: PERGUNTA_FALLBACK,
      brief: anterior,
      prompt_imagem: null,
      pronto: false,
    })
  }

  // Só pode estar "pronto" se houver logo anexada de fato.
  const pronto = Boolean(parsed.pronto && temLogo && parsed.prompt_imagem)
  return NextResponse.json({
    mensagem: parsed.mensagem,
    brief: parsed.brief,
    prompt_imagem: pronto ? parsed.prompt_imagem : null,
    pronto,
  })
}
