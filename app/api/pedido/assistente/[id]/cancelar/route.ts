// POST /api/pedido/assistente/[id]/cancelar — o cliente cancela o pedido (antes
// do pagamento). Acesso por uuid do pedido (padrão público do visualizador).
import { NextResponse } from 'next/server'
import { cancelarPedidoCliente } from '@/app/lib/pedido-assistente-oferta'

export const runtime = 'nodejs'
type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ erro: 'id ausente' }, { status: 400 })
  const r = await cancelarPedidoCliente(id)
  if (!r.ok) return NextResponse.json({ erro: r.erro ?? 'Falha ao cancelar' }, { status: 422 })
  return NextResponse.json({ ok: true })
}
