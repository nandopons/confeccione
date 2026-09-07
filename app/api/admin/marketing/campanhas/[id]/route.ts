// POST   /api/admin/marketing/campanhas/[id] — ações da campanha
//   'disparar' → congela o público e manda o 1º lote
//   'continuar'→ manda o próximo lote (repetir enquanto restar gente)
//   'cancelar' → para de vez
// DELETE /api/admin/marketing/campanhas/[id] — apaga (leva a fila junto)
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import {
  cancelarCampanha,
  excluirCampanha,
  obterCampanha,
  prepararCampanha,
  processarCampanha,
} from '@/app/lib/campanhas-marketing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const Body = z.object({ acao: z.enum(['disparar', 'continuar', 'cancelar']) })

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  const { id } = await params
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ erro: 'Ação inválida' }, { status: 400 })

  if (parsed.data.acao === 'cancelar') {
    await cancelarCampanha(id)
    return NextResponse.json({ ok: true, campanha: await obterCampanha(id) })
  }

  if (parsed.data.acao === 'disparar') {
    const preparo = await prepararCampanha(id)
    if (preparo.status !== 'enviando') {
      return NextResponse.json({ ok: true, agendada: true, total: preparo.total, campanha: await obterCampanha(id) })
    }
  }

  const lote = await processarCampanha(id)
  return NextResponse.json({ ok: true, lote, campanha: await obterCampanha(id) })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  const { id } = await params
  await excluirCampanha(id)
  return NextResponse.json({ ok: true })
}
