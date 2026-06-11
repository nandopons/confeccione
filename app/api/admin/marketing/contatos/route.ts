// GET /api/admin/marketing/contatos?pedido=<uuid> — histórico de contatos
// de marketing de um lead (lembrete/feedback/nutrição/oferta). Cookie admin.
import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { contatosDoLead } from '@/app/lib/marketing-contatos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  const pedido = req.nextUrl.searchParams.get('pedido') ?? ''
  if (!UUID_RE.test(pedido)) {
    return NextResponse.json({ erro: 'Pedido inválido' }, { status: 400 })
  }
  return NextResponse.json({ contatos: await contatosDoLead(pedido) })
}
