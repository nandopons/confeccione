// GET /api/admin/pedidos-assistente?filtro=incompletos|todos
import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { listarPedidosChat } from '@/app/lib/admin-pedidos-assistente'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  const filtro = req.nextUrl.searchParams.get('filtro') === 'todos' ? 'todos' : 'incompletos'
  const pedidos = await listarPedidosChat(filtro)
  return NextResponse.json({ ok: true, pedidos })
}
