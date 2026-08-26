// POST /api/pedido/assistente/[id]/recusar-orcamento — o cliente recusa o
// orçamento do fornecedor. Acesso por uuid do pedido (padrão público do
// visualizador). Zera o orçamento e libera o pedido pra nova oferta.
import { NextResponse } from 'next/server'
import { recusaPorDono } from '@/app/lib/pedido-acesso'
import { recusarOrcamentoCliente } from '@/app/lib/pedido-assistente-oferta'

export const runtime = 'nodejs'
type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ erro: 'id ausente' }, { status: 400 })

  // Se houver sessão de cliente, ela passa a valer: logado como A, não
  // mexe no pedido de B. Anônimo com o link continua passando — é o
  // caminho principal do produto. Ver app/lib/pedido-acesso.ts.
  const recusa = await recusaPorDono(id)
  if (recusa) return NextResponse.json({ erro: recusa }, { status: 403 })

  const r = await recusarOrcamentoCliente(id)
  if (!r.ok) return NextResponse.json({ erro: r.erro ?? 'Falha ao recusar' }, { status: 422 })
  return NextResponse.json({ ok: true })
}
