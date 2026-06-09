// app/api/pedido/assistente/transcrever/route.ts
// POST { audioBase64, mime } -> transcreve o áudio (pt-BR) via Gemini e devolve
// o texto, pra o cliente mandar mensagem de voz no chat de pedido.
import { NextResponse } from 'next/server'
import { z } from 'zod'

export const runtime = 'nodejs'
export const maxDuration = 30

const BodySchema = z.object({
  audioBase64: z.string().min(10),
  mime: z.string().min(3).max(60),
})

const MAX_BYTES = 12 * 1024 * 1024 // ~12MB de áudio base64

export async function POST(req: Request) {
  const key = process.env.GEMINI_API_KEY
  if (!key) return NextResponse.json({ erro: 'Transcrição indisponível.' }, { status: 503 })

  let bruto: unknown
  try { bruto = await req.json() } catch { return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 }) }
  const p = BodySchema.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: 'Áudio inválido' }, { status: 400 })
  if (p.data.audioBase64.length > MAX_BYTES) return NextResponse.json({ erro: 'Áudio muito longo' }, { status: 413 })

  // normaliza o mime (tira ;codecs=...)
  const mime = p.data.mime.split(';')[0].trim()
  const modelo = process.env.GEMINI_TRANSCRIBE_MODEL || 'gemini-2.5-flash'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${key}`

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(25000),
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: 'Transcreva este áudio em português do Brasil. Responda SOMENTE com a transcrição literal do que foi dito, sem comentários, sem aspas.' },
              { inline_data: { mime_type: mime, data: p.data.audioBase64 } },
            ],
          },
        ],
        generationConfig: { temperature: 0 },
      }),
    })
    const j = await r.json().catch(() => null)
    if (!r.ok) {
      console.error('[transcrever] gemini erro', r.status, JSON.stringify(j)?.slice(0, 400))
      return NextResponse.json({ erro: 'Não consegui transcrever o áudio.' }, { status: 502 })
    }
    const partes = j?.candidates?.[0]?.content?.parts ?? []
    const texto = partes.map((x: { text?: string }) => x?.text ?? '').join('').trim()
    if (!texto) return NextResponse.json({ erro: 'Não entendi o áudio. Tente de novo ou digite.' }, { status: 422 })
    return NextResponse.json({ ok: true, texto })
  } catch (err) {
    console.error('[transcrever] exceção', err)
    return NextResponse.json({ erro: 'Falha ao transcrever.' }, { status: 502 })
  }
}
