// PATCH  /api/admin/marketing/leads/[id] — edita ou liga/desliga o opt-out
// DELETE /api/admin/marketing/leads/[id] — remove da base
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { atualizarLead, definirOptOut, excluirLead, obterLead } from '@/app/lib/leads-marketing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Patch = z.object({
  nome: z.string().trim().max(120).nullable().optional(),
  empresa: z.string().trim().max(120).nullable().optional(),
  telefone: z.string().trim().max(30).nullable().optional(),
  email: z.string().trim().max(160).nullable().optional(),
  cidade: z.string().trim().max(80).nullable().optional(),
  uf: z.string().trim().max(2).nullable().optional(),
  observacao: z.string().trim().max(500).nullable().optional(),
  tags: z.array(z.string().trim().max(30)).max(10).optional(),
  status: z.enum(['lead', 'cliente', 'descadastrado']).optional(),
  optOut: z.boolean().optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  const { id } = await params
  const parsed = Patch.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ erro: 'Dados inválidos' }, { status: 400 })

  const { optOut, ...campos } = parsed.data
  if (optOut !== undefined) await definirOptOut(id, optOut)
  if (Object.keys(campos).length > 0) {
    const r = await atualizarLead(id, campos)
    if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: 400 })
  }
  return NextResponse.json({ ok: true, lead: await obterLead(id) })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  const { id } = await params
  await excluirLead(id)
  return NextResponse.json({ ok: true })
}
