// app/api/visualizador/aplicar-arte/route.ts
// ============================================================================
// POST /api/visualizador/aplicar-arte — aplica a(s) arte(s) do cliente sobre o
// mockup já gerado. Recebe a base do mockup (data URL) + 1..N artes (data URLs)
// + instruções do cliente, e devolve a imagem composta. Sem provedor, responde
// 200 com { disponivel:false } e a UI mostra o aviso.
// ============================================================================

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { gerarImagem, type ImagemEntrada } from '@/app/lib/mockup-image'

export const runtime = 'nodejs'

const MAX_TOTAL_BYTES = 18 * 1024 * 1024 // soma das imagens (base + artes)
const MAX_ARTES = 8

const BodySchema = z.object({
  baseDataUrl: z.string().min(1),
  artes: z.array(z.string().min(1)).min(1).max(MAX_ARTES),
  instrucoes: z.string().max(4000).optional().default(''),
  contexto: z.string().max(2000).optional().default(''), // ex.: "oversized preta, algodão"
})

function parseDataUrl(dataUrl: string): ImagemEntrada | null {
  const m = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl.trim())
  if (!m) return null
  return { mime: m[1], base64: m[2] }
}

function bytesDe(base64: string): number {
  return Math.floor((base64.length * 3) / 4)
}

export async function POST(req: Request) {
  let bruto: unknown
  try {
    bruto = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido no corpo.' }, { status: 400 })
  }

  const body = BodySchema.safeParse(bruto)
  if (!body.success) {
    return NextResponse.json({ error: 'Formato esperado: { baseDataUrl, artes[], instrucoes }' }, { status: 400 })
  }

  const base = parseDataUrl(body.data.baseDataUrl)
  if (!base) {
    return NextResponse.json({ error: 'baseDataUrl deve ser um data URL base64.' }, { status: 400 })
  }
  const artes: ImagemEntrada[] = []
  for (const a of body.data.artes) {
    const p = parseDataUrl(a)
    if (!p) return NextResponse.json({ error: 'Uma das artes não é um data URL válido.' }, { status: 400 })
    artes.push(p)
  }

  const total = bytesDe(base.base64) + artes.reduce((acc, a) => acc + bytesDe(a.base64), 0)
  if (total > MAX_TOTAL_BYTES) {
    return NextResponse.json({ error: 'Imagens grandes demais no total (máx. ~18 MB).' }, { status: 400 })
  }

  const ctx = body.data.contexto?.trim()
  const instr = body.data.instrucoes?.trim()
  const prompt = [
    'A PRIMEIRA imagem é o mockup base: uma foto panorâmica com a MESMA peça em três ângulos lado a lado — FRENTE (esquerda), LATERAL (centro) e COSTAS (direita).',
    artes.length > 1
      ? `As ${artes.length} imagens seguintes são artes/estampas do cliente.`
      : 'A imagem seguinte é a arte/estampa do cliente.',
    'Aplique a(s) arte(s) sobre a peça de forma realista, acompanhando dobras, perspectiva e iluminação do tecido, COERENTE nas três vistas: o que vai na frente aparece na vista de frente; o que vai nas costas aparece na vista de costas; a vista lateral mostra o que estiver no lado correspondente.',
    'MANTENHA exatamente o mesmo layout panorâmico de três ângulos, o mesmo modelo, a mesma cor e os mesmos enquadramentos do base — apenas adicione a estampa.',
    ctx ? `Contexto do produto: ${ctx}.` : '',
    instr ? `Instruções do cliente sobre como aplicar: ${instr}.` : 'Se não houver instrução específica, posicione a arte de forma centralizada e proporcional no peito, com bom senso.',
    'Devolva apenas a imagem final (panorâmica, três ângulos) com a arte aplicada.',
  ].filter(Boolean).join(' ')

  const r = await gerarImagem({ prompt, imagens: [base, ...artes] })

  if (!r.disponivel) {
    return NextResponse.json({ disponivel: false, motivo: r.motivo })
  }
  return NextResponse.json({
    disponivel: true,
    imagemDataUrl: `data:${r.mime};base64,${r.imagemBase64}`,
  })
}
