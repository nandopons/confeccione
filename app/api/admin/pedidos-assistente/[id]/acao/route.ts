// POST /api/admin/pedidos-assistente/[id]/acao { acao: excluir|lembrete|feedback }
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { acaoPedidoChat } from '@/app/lib/admin-pedidos-assistente'

export const runtime = 'nodejs'
type Ctx = { params: Promise<{ id: string }> }
const BodySchema = z.object({ acao: z.enum(['excluir', 'lembrete', 'feedback']) })

export async function POST(req: NextRequest, ctx: Ctx) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  const { id } = await ctx.params
  let bruto: unknown
  try { bruto = await req.json() } catch { return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 }) }
  const p = BodySchema.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: 'Ação inválida' }, { status: 400 })
  const r = await acaoPedidoChat(id, p.data.acao)
  if (!r.ok) return NextResponse.json({ erro: r.erro ?? 'Falha' }, { status: 422 })
  return NextResponse.json({ ok: true, whats: r.whats, email: r.email })
}
