// POST /api/fornecedor/oferta/[id]/pesquisar-preco { linha:number }
// Fornecedor dispara a pesquisa de mercado de um produto do pedido. Acesso por
// uuid da oferta (mesmo padrão público da página da oferta). Devolve o orçamento
// recarregado com a sugestão da plataforma preenchida.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { pesquisarPrecoLinhaOferta } from '@/app/lib/pedido-assistente-oferta'

export const runtime = 'nodejs'
export const maxDuration = 60

const BodySchema = z.object({ linha: z.number().int().min(0).max(49) })
type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ erro: 'id ausente' }, { status: 400 })

  let bruto: unknown
  try { bruto = await req.json() } catch { return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 }) }
  const p = BodySchema.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: 'Produto inválido' }, { status: 400 })

  const r = await pesquisarPrecoLinhaOferta(id, p.data.linha)
  if (!r.ok) return NextResponse.json({ erro: r.erro ?? 'Falha na pesquisa' }, { status: 422 })

  return NextResponse.json({ ok: true, dados: r.dados })
}
