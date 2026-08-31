// app/api/pedido/assistente/[id]/imagem/route.ts
// GET ?i=N → serve a imagem N do pedido (salva ao confirmar). Acesso por uuid.
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { coletarVisuaisPedido, type MapaMockups } from '@/app/lib/pedido-visuais'
import { lerImagem } from '@/app/lib/imagens-pedido-storage'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const i = parseInt(req.nextUrl.searchParams.get('i') ?? '0', 10) || 0

  const { data } = await supabase.from('pedidos_assistente').select('imagens, mockups').eq('id', id).maybeSingle<{ imagens: unknown[] | null; mockups: MapaMockups | null }>()
  const lista = coletarVisuaisPedido(data?.mockups, data?.imagens)
  const ref = lista[i]
  if (!ref) return NextResponse.json({ erro: 'Não encontrado' }, { status: 404 })

  // Entende os dois formatos: data URI legado (gravado no banco) e referência
  // de Storage. Ver app/lib/imagens-pedido-storage.ts.
  const img = await lerImagem(ref)
  if (!img) return NextResponse.json({ erro: 'Imagem inválida' }, { status: 500 })

  return new NextResponse(new Uint8Array(img.bytes), {
    status: 200,
    headers: { 'Content-Type': img.mime, 'Cache-Control': 'public, max-age=86400' },
  })
}
