// app/api/pedido/assistente/[id]/mockup-thumb/route.ts
// GET → serve a 1ª imagem salva do pedido (memória do mockup) pra miniatura no
// painel do cliente. Prioriza a arte aplicada; senão o liso; senão imagens[0].
// Público por uuid. 404 se não houver nada salvo ainda.
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type Ctx = { params: Promise<{ id: string }> }
type Mapa = Record<string, { liso?: string; arte?: string }>

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const { data } = await supabase
    .from('pedidos_assistente')
    .select('mockups, imagens')
    .eq('id', id)
    .maybeSingle<{ mockups: Mapa | null; imagens: string[] | null }>()
  if (!data) return NextResponse.json({ erro: 'Não encontrado' }, { status: 404 })

  let dataUrl: string | undefined
  const mapa = data.mockups && typeof data.mockups === 'object' ? data.mockups : {}
  const keys = Object.keys(mapa).map(Number).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b)
  for (const k of keys) {
    const v = mapa[String(k)] || {}
    const pick = v.arte || v.liso
    if (pick) { dataUrl = pick; break }
  }
  if (!dataUrl && Array.isArray(data.imagens) && data.imagens[0]) dataUrl = data.imagens[0]
  if (!dataUrl) return NextResponse.json({ erro: 'Sem mockup' }, { status: 404 })

  const m = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl)
  if (!m) return NextResponse.json({ erro: 'Imagem inválida' }, { status: 500 })
  const bytes = Buffer.from(m[2], 'base64')
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: { 'Content-Type': m[1], 'Cache-Control': 'private, max-age=60' },
  })
}
