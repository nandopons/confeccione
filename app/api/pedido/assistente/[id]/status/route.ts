// app/api/pedido/assistente/[id]/status/route.ts
// GET → status de pagamento do pedido (pra liberar o download após pago).
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { coletarVisuaisPedido, type MapaMockups } from '@/app/lib/pedido-visuais'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const { data } = await supabase
    .from('pedidos_assistente')
    .select('pagamento_status, imagens, mockups')
    .eq('id', id)
    .maybeSingle()
  if (!data) return NextResponse.json({ erro: 'Pedido não encontrado' }, { status: 404 })
  const pago = data.pagamento_status === 'pago'
  const numImagens = coletarVisuaisPedido((data as { mockups: MapaMockups | null }).mockups, (data as { imagens: unknown[] | null }).imagens).length
  return NextResponse.json({ ok: true, pagamento_status: data.pagamento_status ?? null, pago, numImagens })
}
