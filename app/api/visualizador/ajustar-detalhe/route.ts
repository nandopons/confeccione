// app/api/visualizador/ajustar-detalhe/route.ts
// POST { baseDataUrl, instrucoes, contexto? } — edita APENAS o detalhe pedido
// na imagem atual (mockup com ou sem arte), preservando todo o resto.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { gerarImagem, type ImagemEntrada } from '@/app/lib/mockup-image'
import { normalizarMockup } from '@/app/lib/imagem-normalizar'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_BYTES = 14 * 1024 * 1024

const BodySchema = z.object({
  baseDataUrl: z.string().min(1),
  instrucoes: z.string().min(2).max(2000),
  contexto: z.string().max(2000).optional().default(''),
})

function parseDataUrl(dataUrl: string): ImagemEntrada | null {
  const m = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl.trim())
  if (!m) return null
  return { mime: m[1], base64: m[2] }
}

export async function POST(req: Request) {
  let bruto: unknown
  try { bruto = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }
  const body = BodySchema.safeParse(bruto)
  if (!body.success) return NextResponse.json({ error: 'Informe baseDataUrl e instrucoes.' }, { status: 400 })

  const base = parseDataUrl(body.data.baseDataUrl)
  if (!base) return NextResponse.json({ error: 'baseDataUrl inválido.' }, { status: 400 })
  if (Math.floor((base.base64.length * 3) / 4) > MAX_BYTES) return NextResponse.json({ error: 'Imagem grande demais.' }, { status: 413 })

  const ctx = body.data.contexto?.trim()
  const instr = body.data.instrucoes.trim()
  const prompt = [
    'Esta imagem é um mockup panorâmico de catálogo: a MESMA peça em três ângulos lado a lado — FRENTE (esquerda), LATERAL (centro) e COSTAS (direita).',
    'Faça SOMENTE o ajuste pedido pelo cliente abaixo, mantendo IDÊNTICO todo o resto: a mesma peça, cor, modelo, material, a mesma arte/estampa/bordado já presente, o mesmo modelo que veste, o mesmo enquadramento e o mesmo fundo. NÃO recrie a peça do zero, NÃO mude o que não foi pedido.',
    `AJUSTE PEDIDO: ${instr}.`,
    ctx ? `Contexto do produto: ${ctx}.` : '',
    'CRÍTICO: devolva na MESMA proporção panorâmica larga (~16:7), com as TRÊS vistas (frente, lateral, costas) COMPLETAS e visíveis, sem cortar, sem zoom, sem reposicionar. Fundo branco uniforme.',
    'Devolva apenas a imagem final ajustada.',
  ].filter(Boolean).join(' ')

  const r = await gerarImagem({ prompt, imagens: [base], aspectRatio: '21:9', imageSize: '2K' })
  if (!r.disponivel) return NextResponse.json({ disponivel: false, motivo: r.motivo })
  return NextResponse.json({ disponivel: true, imagemDataUrl: await normalizarMockup(`data:${r.mime};base64,${r.imagemBase64}`) })
}
