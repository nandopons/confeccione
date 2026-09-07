// GET /api/admin/marketing/leads/export — base de leads em CSV (mesmos filtros da tela).
import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { filtroLeadsDaQuery, leadsParaCsv, listarLeadsCompleto } from '@/app/lib/leads-marketing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  const csv = leadsParaCsv(await listarLeadsCompleto(filtroLeadsDaQuery(req.nextUrl.searchParams)))
  const hoje = new Date().toISOString().slice(0, 10)
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="leads-confeccione-${hoje}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
