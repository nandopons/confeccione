// app/api/admin/pedidos-pagos/ofertar/route.ts
// POST { pedidoId, fornecedorIds[] } — oferta um pedido pago aos fornecedores
// escolhidos (cria ofertas + dispara WhatsApp). Guardado por cookie admin.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { ofertarPedido } from '@/app/lib/pedido-assistente-oferta'

export const runtime = 'nodejs'
export const maxDuration = 60

const UUID = z.string().uuid()
const BodySchema = z.object({
  pedidoId: UUID,
  fornecedorIds: z.array(UUID).min(1).max(40),
})

export async function POST(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  let bruto: unknown
  try { bruto = await req.json() } catch { return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 }) }
  const p = BodySchema.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: 'Informe pedidoId e ao menos 1 fornecedor.' }, { status: 400 })

  const r = await ofertarPedido(p.data.pedidoId, p.data.fornecedorIds)
  if (!r.ok) return NextResponse.json({ erro: r.erro ?? 'Falha ao ofertar' }, { status: 422 })
  return NextResponse.json({ ok: true, criadas: r.criadas, notificadas: r.notificadas })
}
