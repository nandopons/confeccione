// GET /api/pedido/assistente/[id]/perguntas — threads de perguntas do pedido,
// agrupadas por fornecedor e anonimizadas ("Fornecedor 1", "Fornecedor 2"…).
// Visão do cliente no visualizador. Acesso pelo uuid do pedido.
import { NextResponse } from 'next/server'
import { listarThreadsPedido } from '@/app/lib/perguntas'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ erro: 'id ausente' }, { status: 400 })
  const threads = await listarThreadsPedido(id)
  return NextResponse.json({ ok: true, threads })
}
