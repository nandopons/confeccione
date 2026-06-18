// POST /api/admin/pedidos-assistente/[id]/pesquisar-preco { linha:number }
// Admin dispara a pesquisa de mercado de um produto do pedido e a salva em
// pesquisas_preco. Devolve o preço unitário de mercado p/ a quantidade da linha.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { pesquisarPrecoLinhaPedido } from '@/app/lib/admin-pedidos-assistente'

export const runtime = 'nodejs'
export const maxDuration = 60

const BodySchema = z.object({ linha: z.number().int().min(0).max(49) })
type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: Ctx) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  const { id } = await ctx.params
  let bruto: unknown
  try { bruto = await req.json() } catch { return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 }) }
  const p = BodySchema.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: 'Produto inválido' }, { status: 400 })

  const r = await pesquisarPrecoLinhaPedido(id, p.data.linha)
  if (!r.ok) return NextResponse.json({ erro: r.erro ?? 'Falha na pesquisa' }, { status: 422 })

  return NextResponse.json({ ok: true, unitClienteCentavos: r.unitClienteCentavos, qtd: r.qtd, observacao: r.observacao })
}
