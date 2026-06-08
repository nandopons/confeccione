// app/api/pedido/assistente/[id]/status/route.ts
// GET → status de pagamento do pedido (pra liberar o download após pago).
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
  const { data } = await supabase
    .from('pedidos_assistente')
    .select('pagamento_status, imagens')
    .eq('id', id)
    .maybeSingle()
  if (!data) return NextResponse.json({ erro: 'Pedido não encontrado' }, { status: 404 })
  const pago = data.pagamento_status === 'pago'
  const numImagens = Array.isArray(data.imagens) ? data.imagens.length : 0
  return NextResponse.json({ ok: true, pagamento_status: data.pagamento_status ?? null, pago, numImagens })
}
