// app/api/admin/pedidos-assistente/finalizar/route.ts
// POST { id, desfazer? } — marca o pedido assistido como FINALIZADO (entregue)
// ou desfaz a marcação. Etapa final do fluxo: pago → em produção → finalizado.
//
// Por enquanto é manual no admin. Próxima fase: o cliente marca "recebi o
// pedido" no painel dele (estilo Mercado Livre) + auto-finalização em 7 dias.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BodySchema = z.object({ id: z.string().uuid(), desfazer: z.boolean().optional() })

export async function POST(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  let bruto: unknown
  try {
    bruto = await req.json()
  } catch {
    return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 })
  }
  const p = BodySchema.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: 'Dados inválidos' }, { status: 400 })
  const { id, desfazer } = p.data

  const { data: pedido } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, pagamento_status, finalizado_em')
    .eq('id', id)
    .maybeSingle<{ id: string; pagamento_status: string | null; finalizado_em: string | null }>()
  if (!pedido) return NextResponse.json({ erro: 'Pedido não encontrado' }, { status: 404 })

  if (!desfazer && pedido.pagamento_status !== 'pago') {
    return NextResponse.json({ erro: 'Só dá pra finalizar pedido já pago.' }, { status: 422 })
  }

  const finalizadoEm = desfazer ? null : new Date().toISOString()
  const { error } = await supabaseAdmin
    .from('pedidos_assistente')
    .update({ finalizado_em: finalizadoEm, atualizado_em: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, finalizadoEm })
}
