// app/api/admin/pedidos-pagos/reabrir/route.ts
// POST { pedidoId } — reabre um pedido pra ofertar de novo: cancela as ofertas
// em aberto/aceitas e zera o orçamento (não mexe no pagamento). Guardado por
// cookie admin.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { reabrirPedido } from '@/app/lib/pedido-assistente-oferta'

export const runtime = 'nodejs'

const BodySchema = z.object({
  pedidoId: z.string().uuid(),
})

export async function POST(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  let bruto: unknown
  try { bruto = await req.json() } catch { return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 }) }
  const p = BodySchema.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: 'Informe pedidoId.' }, { status: 400 })

  const r = await reabrirPedido(p.data.pedidoId)
  if (!r.ok) return NextResponse.json({ erro: r.erro ?? 'Falha ao reabrir' }, { status: 422 })
  return NextResponse.json({ ok: true })
}
