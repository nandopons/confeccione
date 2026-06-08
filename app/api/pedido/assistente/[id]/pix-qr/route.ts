// app/api/pedido/assistente/[id]/pix-qr/route.ts
// GET → serve o QR Code PIX (PNG) do pedido. Acesso por uuid.
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const { data } = await supabase.from('pedidos_assistente').select('pix_qr_imagem').eq('id', id).maybeSingle()
  const b64 = data?.pix_qr_imagem as string | null | undefined
  if (!b64) return NextResponse.json({ erro: 'Não encontrado' }, { status: 404 })

  const limpo = b64.includes(',') ? b64.split(',', 2)[1] : b64
  const bytes = Buffer.from(limpo, 'base64')
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' },
  })
}
