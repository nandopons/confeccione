/**
 * POST /api/admin/fornecedores/[id]/reprovar
 * Body opcional: { motivo?: string }
 * Marca o fornecedor como reprovado (não recebe pedidos). Idempotente.
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

  const { data: forn, error: errGet } = await supabaseAdmin
    .from('leads_fornecedores')
    .select('id, aprovacao_status')
    .eq('id', id)
    .maybeSingle()
  if (errGet) return NextResponse.json({ erro: errGet.message }, { status: 500 })
  if (!forn) return NextResponse.json({ erro: 'Fornecedor não encontrado' }, { status: 404 })

  const agora = new Date().toISOString()
  const { error: errUpd } = await supabaseAdmin
    .from('leads_fornecedores')
    .update({ aprovacao_status: 'reprovado', aprovacao_em: agora, aprovacao_motivo: motivo, atualizado_em: agora })
    .eq('id', id)
  if (errUpd) return NextResponse.json({ erro: errUpd.message }, { status: 500 })

  await registrarAudit({
    ator: 'admin',
    acao: 'fornecedor.reprovar',
    entidade_tipo: 'leads_fornecedores',
    entidade_id: id,
    mudancas: { aprovacao_status: { de: forn.aprovacao_status, para: 'reprovado' } },
    metadata: { motivo, user_agent: req.headers.get('user-agent') ?? null },
  })

  return NextResponse.json({ ok: true })
}
