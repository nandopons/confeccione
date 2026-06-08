// app/api/pedido/assistente/[id]/imagem/route.ts
// GET ?i=N → serve a imagem N do pedido (salva ao confirmar). Acesso por uuid.
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const i = parseInt(req.nextUrl.searchParams.get('i') ?? '0', 10) || 0

  const { data } = await supabase.from('pedidos_assistente').select('imagens').eq('id', id).maybeSingle()
  const imagens = (data?.imagens ?? []) as string[]
  const dataUrl = imagens[i]
  if (!dataUrl) return NextResponse.json({ erro: 'Não encontrado' }, { status: 404 })

  const m = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl)
  if (!m) return NextResponse.json({ erro: 'Imagem inválida' }, { status: 500 })

  const bytes = Buffer.from(m[2], 'base64')
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: { 'Content-Type': m[1], 'Cache-Control': 'public, max-age=86400' },
  })
}
