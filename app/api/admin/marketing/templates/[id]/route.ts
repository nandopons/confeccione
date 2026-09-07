// PATCH  /api/admin/marketing/templates/[id] — edita
// DELETE /api/admin/marketing/templates/[id] — exclui (barrado se estiver em fluxo)
import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { atualizarTemplate, excluirTemplate, obterTemplate } from '@/app/lib/templates-marketing'
import { TemplatePatchSchema } from '@/app/lib/marketing-schemas'
import { normalizarBlocos } from '@/app/lib/email-blocos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  const { id } = await params
  const parsed = TemplatePatchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ erro: 'Dados inválidos' }, { status: 400 })
  try {
    await atualizarTemplate(id, { ...parsed.data, blocos: parsed.data.blocos && normalizarBlocos(parsed.data.blocos) })
    return NextResponse.json({ ok: true, template: await obterTemplate(id) })
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Falha ao salvar' }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  const { id } = await params
  const r = await excluirTemplate(id)
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ erro: r.erro }, { status: 400 })
}
