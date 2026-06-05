// app/api/pedido/organizar-descricao/route.ts
// ============================================================================
// POST /api/pedido/organizar-descricao — organiza a descrição escrita pelo
// cliente com IA, pra exibir na revisão final (editável) antes do envio.
//
// Server-side only (mesmo padrão de /api/pedido/chat). NÃO persiste nada e
// NUNCA bloqueia o pedido: em QUALQUER erro (inclusive key ausente), devolve
// 200 com a descrição original.
//
// body: { descricao: string, tipo?: string }
// resposta: { descricao_organizada: string }
// ============================================================================

import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { getSegmento } from '@/app/lib/captacao-templates'

export const runtime = 'nodejs'

const MODELO = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 500
const TEMPERATURE = 0.3
const MIN_CHARS = 15
const MAX_ENTRADA = 2000

const SYSTEM_PROMPT = `Você organiza a descrição de um pedido de confecção escrita pelo cliente. Reescreva em português claro e enxuto, corrigindo gramática e agrupando os detalhes de forma legível para o fornecedor (modelo/peça, detalhes construtivos, grade de tamanhos, acabamento, cores).

Preserve TODOS os detalhes que o cliente deu e NÃO invente nenhum dado que ele não escreveu. Se faltar algo (ex.: quantidade), não preencha — apenas organize o que veio. Use o tipo do produto só como contexto.

Responda SOMENTE com o texto organizado — sem markdown, sem cercas de código, sem preâmbulo, sem comentários.`

export async function POST(req: Request) {
  // Leitura defensiva do body — nada aqui pode 400/500 e bloquear o pedido.
  let descricao = ''
  let tipo: string | undefined
  try {
    const body = await req.json()
    if (typeof body?.descricao === 'string') descricao = body.descricao
    if (typeof body?.tipo === 'string') tipo = body.tipo
  } catch {
    return NextResponse.json({ descricao_organizada: descricao })
  }

  const original = descricao

  // Curta/vazia: não chama IA.
  if (descricao.trim().length < MIN_CHARS) {
    return NextResponse.json({ descricao_organizada: original })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[organizar-descricao] ANTHROPIC_API_KEY ausente no ambiente')
    return NextResponse.json({ descricao_organizada: original })
  }

  try {
    const entrada = descricao.slice(0, MAX_ENTRADA)
    const seg = tipo ? getSegmento(tipo) : undefined
    const contexto = seg ? `Tipo do produto (contexto): ${seg.nome}.\n\n` : ''

    const client = new Anthropic({ apiKey })
    const resposta = await client.messages.create({
      model: MODELO,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      messages: [
        { role: 'user', content: `${contexto}Descrição do cliente:\n${entrada}` },
      ],
    })

    const texto = resposta.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()

    return NextResponse.json({ descricao_organizada: texto || original })
  } catch (err) {
    console.error('[organizar-descricao] falha ao organizar:', err)
    return NextResponse.json({ descricao_organizada: original })
  }
}
