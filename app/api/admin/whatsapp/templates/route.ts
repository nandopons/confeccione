// app/api/admin/whatsapp/templates/route.ts
// GET → templates aprovados da WABA (pra enviar fora da janela de 24h).

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { listarTemplates } from '@/app/lib/whatsapp-cloud'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  }
  const templates = await listarTemplates()
  return NextResponse.json({ templates })
}
