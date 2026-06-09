// app/api/admin/pedidos-pagos/oferta-status/route.ts
// POST { ofertaId, status: 'aceita'|'recusada'|'cancelada' } — registra a
// resposta do fornecedor (que chegou pelo WhatsApp). Ao aceitar, cancela as
// demais ofertas em aberto do mesmo pedido. Guardado por cookie admin.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { definirStatusOferta } from '@/app/lib/pedido-assistente-oferta'

export const runtime = 'nodejs'

const BodySchema = z.object({
  ofertaId: z.string().uuid(),
  status: z.enum(['aceita', 'recusada', 'cancelada']),
})

export async function POST(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  let bruto: unknown
  try { bruto = await req.json() } catch { return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 }) }
  const p = BodySchema.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: 'Body inválido' }, { status: 400 })

  const r = await definirStatusOferta(p.data.ofertaId, p.data.status)
  if (!r.ok) return NextResponse.json({ erro: r.erro ?? 'Falha' }, { status: 422 })
  return NextResponse.json({ ok: true })
}
