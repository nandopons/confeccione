// POST /api/admin/marketing/leads/sincronizar — puxa pra base de marketing
// todo mundo que já apareceu no site (pedidos do chat + contas de cliente).
// Idempotente; pode rodar sempre.
import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { sincronizarLeadsDoSite } from '@/app/lib/leads-marketing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  return NextResponse.json({ ok: true, resultado: await sincronizarLeadsDoSite() })
}
