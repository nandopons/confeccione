// app/api/mockup/gerar/route.ts
// ============================================================================
// POST /api/mockup/gerar — recebe a logo (base64) + o prompt montado no chat e
// devolve a imagem do mockup. Se o provedor de imagem não estiver configurado,
// responde 200 com { disponivel: false } (a UI cai num estado de prévia).
// ============================================================================

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { gerarMockup } from '@/app/lib/mockup-image'

export const runtime = 'nodejs'

const MAX_LOGO_BYTES = 5 * 1024 * 1024 // 5 MB
const MAX_PROMPT = 4000

const BodySchema = z.object({
  prompt: z.string().min(1).max(MAX_PROMPT),
  // data URL "data:image/png;base64,XXXX" OU base64 puro + mime separado
  logoDataUrl: z.string().min(1),
})

function parseDataUrl(dataUrl: string): { base64: string; mime: string } | null {
  const m = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl.trim())
  if (!m) return null
  return { mime: m[1], base64: m[2] }
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
    return NextResponse.json({ error: 'Formato esperado: { prompt, logoDataUrl }' }, { status: 400 })
  }

  const parsed = parseDataUrl(body.data.logoDataUrl)
  if (!parsed) {
    return NextResponse.json({ error: 'logoDataUrl deve ser um data URL base64.' }, { status: 400 })
  }

  // tamanho aproximado do binário a partir do base64
  const aprox = Math.floor((parsed.base64.length * 3) / 4)
  if (aprox > MAX_LOGO_BYTES) {
    return NextResponse.json({ error: 'Arquivo da logo grande demais (máx. 5 MB).' }, { status: 400 })
  }

  const resultado = await gerarMockup({
    prompt: body.data.prompt,
    logoBase64: parsed.base64,
    logoMime: parsed.mime,
  })

  if (!resultado.disponivel) {
    return NextResponse.json({ disponivel: false, motivo: resultado.motivo, prompt: body.data.prompt })
  }

  return NextResponse.json({
    disponivel: true,
    imagemDataUrl: `data:${resultado.mime};base64,${resultado.imagemBase64}`,
  })
}
