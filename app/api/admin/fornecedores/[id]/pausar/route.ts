/**
 * POST /api/admin/fornecedores/[id]/pausar
 * Body opcional: { motivo?: string }
 * Idempotente: já pausado → ok sem regravar audit.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { registrarAudit } from '@/app/lib/audit'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const cookieValue = req.cookies.get(COOKIE_ADMIN)?.value
  if (!ehTokenAdminValido(cookieValue)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { motivo?: string }
  const motivo =
    typeof body.motivo === 'string' && body.motivo.trim()
      ? body.motivo.trim().slice(0, 500)
      : null

  const { data: antes, error: errBefore } = await supabaseAdmin
    .from('leads_fornecedores')
    .select('status, motivo_pausa')
    .eq('id', id)
    .maybeSingle()

  if (errBefore) return NextResponse.json({ erro: errBefore.message }, { status: 500 })
  if (!antes) return NextResponse.json({ erro: 'Fornecedor não encontrado' }, { status: 404 })

  if (antes.status === 'pausado') {
    return NextResponse.json({ ok: true, ja_pausado: true })
  }

  const agora = new Date().toISOString()
  const { error: errUpd } = await supabaseAdmin
    .from('leads_fornecedores')
    .update({
      status: 'pausado',
      pausado_em: agora,
      motivo_pausa: motivo,
      atualizado_em: agora,
    })
    .eq('id', id)

  if (errUpd) return NextResponse.json({ erro: errUpd.message }, { status: 500 })

  await registrarAudit({
    ator: 'admin',
    acao: 'fornecedor.pausar',
    entidade_tipo: 'leads_fornecedores',
    entidade_id: id,
    mudancas: {
      status: { de: antes.status, para: 'pausado' },
      motivo_pausa: { de: antes.motivo_pausa ?? null, para: motivo },
    },
    metadata: { user_agent: req.headers.get('user-agent') ?? null },
  })

  return NextResponse.json({ ok: true })
}
