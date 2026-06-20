// POST /api/pedido/assistente/[id]/recusar-orcamento — o cliente recusa o
// orçamento do fornecedor. Acesso por uuid do pedido (padrão público do
// visualizador). Zera o orçamento e libera o pedido pra nova oferta.
import { NextResponse } from 'next/server'
import { recusarOrcamentoCliente } from '@/app/lib/pedido-assistente-oferta'

export const runtime = 'nodejs'
type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ erro: 'id ausente' }, { status: 400 })
  const r = await recusarOrcamentoCliente(id)
  if (!r.ok) return NextResponse.json({ erro: r.erro ?? 'Falha ao recusar' }, { status: 422 })
  return NextResponse.json({ ok: true })
}
