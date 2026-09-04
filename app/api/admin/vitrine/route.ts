// PATCH /api/admin/vitrine — promove/tira uma foto do carrossel da home.
import { NextResponse } from 'next/server'
import { eAdminLogado } from '@/app/lib/admin-auth'
import { definirDestaque } from '@/app/lib/portfolio-fornecedor'

export async function PATCH(req: Request) {
  if (!(await eAdminLogado())) {
    return NextResponse.json({ error: 'não autorizado' }, { status: 401 })
  }

  let body: { id?: unknown; destaque?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'payload inválido' }, { status: 400 })
  }

  if (typeof body.id !== 'string' || typeof body.destaque !== 'boolean') {
    return NextResponse.json({ error: 'informe id e destaque' }, { status: 400 })
  }

  const ok = await definirDestaque(body.id, body.destaque)
  if (!ok) return NextResponse.json({ error: 'não consegui atualizar' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
