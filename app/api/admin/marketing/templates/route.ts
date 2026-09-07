// GET  /api/admin/marketing/templates?canal=email — biblioteca de templates
// POST /api/admin/marketing/templates — cria um template
import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { criarTemplate, listarTemplates } from '@/app/lib/templates-marketing'
import { TemplateNovoSchema } from '@/app/lib/marketing-schemas'
import { normalizarBlocos } from '@/app/lib/email-blocos'
import type { CanalEnvio } from '@/app/lib/envio-marketing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  const canal = req.nextUrl.searchParams.get('canal') as CanalEnvio | null
  return NextResponse.json({ templates: await listarTemplates(canal ?? undefined) })
}

export async function POST(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  const parsed = TemplateNovoSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' }, { status: 400 })
  }
  try {
    return NextResponse.json({ ok: true, template: await criarTemplate({ ...parsed.data, blocos: parsed.data.blocos && normalizarBlocos(parsed.data.blocos) }) })
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Falha ao criar' }, { status: 400 })
  }
}
