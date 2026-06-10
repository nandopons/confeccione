// GET /api/admin/marketing/export — baixa a base de leads em CSV (backup).
import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { listarLeadsMarketing, leadsParaCsv } from '@/app/lib/marketing'
import { SITE_URL } from '@/app/lib/url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  const leads = await listarLeadsMarketing()
  const csv = leadsParaCsv(leads, SITE_URL)
  const hoje = new Date().toISOString().slice(0, 10)
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="clientes-confeccione-${hoje}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
