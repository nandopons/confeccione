// app/api/admin/pedidos-pagos/encerrar/route.ts
// POST { pedidoId, motivo, observacao? }         → dá o pedido como perdido (D-8)
// POST { pedidoId, desfazer: true }               → reabre um pedido encerrado
// Sempre por decisão humana, sempre com motivo. Cookie admin.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { encerrarPedido, MOTIVOS_ENCERRAMENTO, reabrirPedidoEncerrado } from '@/app/lib/etapas-pedido'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Corpo = z.union([
  z.object({ pedidoId: z.string().uuid(), desfazer: z.literal(true) }),
  z.object({
    pedidoId: z.string().uuid(),
    motivo: z.enum(MOTIVOS_ENCERRAMENTO),
    observacao: z.string().trim().max(500).optional(),
  }),
])

export async function POST(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  const parsed = Corpo.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ erro: 'Dados inválidos' }, { status: 400 })

  try {
    if ('desfazer' in parsed.data) {
      const p = await reabrirPedidoEncerrado(parsed.data.pedidoId)
      return NextResponse.json({ ok: true, pedido: p })
    }
    const p = await encerrarPedido(parsed.data.pedidoId, parsed.data.motivo, 'admin', parsed.data.observacao ?? null)
    return NextResponse.json({ ok: true, pedido: p })
  } catch (err) {
    const erro = err instanceof Error ? err.message : 'Falha ao encerrar'
    return NextResponse.json({ erro }, { status: 400 })
  }
}
