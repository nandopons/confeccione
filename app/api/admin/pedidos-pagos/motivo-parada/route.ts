// app/api/admin/pedidos-pagos/motivo-parada/route.ts
// POST { pedidoId, motivo } → registra por que o cliente parou, sem encerrar.
// É o que o Luigi (ou o Fernando) descobre na conversa: "esperando data
// melhor", "achou caro", "não gostou do fornecedor". Cookie admin.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { registrarMotivoParada } from '@/app/lib/etapas-pedido'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Corpo = z.object({ pedidoId: z.string().uuid(), motivo: z.string().trim().min(3).max(500) })

export async function POST(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  const parsed = Corpo.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ erro: 'Dados inválidos' }, { status: 400 })
  try {
    const p = await registrarMotivoParada(parsed.data.pedidoId, parsed.data.motivo)
    return NextResponse.json({ ok: true, pedido: p })
  } catch (err) {
    const erro = err instanceof Error ? err.message : 'Falha ao registrar'
    return NextResponse.json({ erro }, { status: 400 })
  }
}
