// app/api/admin/pedidos-pagos/route.ts
// GET — lista pedidos pagos (pedidos_assistente, pagamento_status='pago') com
// suas ofertas + os fornecedores disponíveis pro seletor. Guardado por cookie
// admin.
import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { listarPedidosPagos } from '@/app/lib/pedido-assistente-oferta'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  const dados = await listarPedidosPagos()
  return NextResponse.json({ ok: true, ...dados })
}
