// app/api/admin/whatsapp/conversas/[id]/tipo-contato/route.ts
// ============================================================================
// "Isto aqui é cliente, não confecção" — a correção pelo inbox.
//
// O Luigi tem a ferramenta `corrigir_tipo_de_contato` pra quando ELE percebe.
// Esta rota é o mesmo conserto pelo lado do Fernando, porque às vezes ele vê
// antes — e porque a pessoa presa do lado errado não pode depender de o modelo
// ter um bom dia.
//
// As travas são as MESMAS, e não por disciplina: são literalmente a mesma
// função (`reclassificarFornecedor`, em app/lib/classificacao-contato.ts). Foi
// a regra morando em dois lugares que fez o selo do inbox dizer FORNECEDOR
// enquanto o agente já atendia como cliente.
//
// NÃO DELETA o lead: marca `reclassificado_em/motivo/por`. Portfólio, perfil de
// produção e histórico continuam lá pra o dia em que ela produzir de verdade.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { reclassificarFornecedor } from '@/app/lib/classificacao-contato'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  }
  const { id } = await ctx.params
  const body = (await req.json().catch(() => null)) as { para?: string; motivo?: string } | null
  const para = body?.para
  const motivo = (body?.motivo ?? '').trim()
  if (para !== 'cliente' && para !== 'fornecedor') {
    return NextResponse.json({ erro: 'para precisa ser "cliente" ou "fornecedor"' }, { status: 400 })
  }
  // O motivo é obrigatório também pelo botão: sem ele o histórico fica com a
  // mudança e sem a razão, que é metade do valor de não deletar.
  if (motivo.length < 3) {
    return NextResponse.json({ erro: 'escreva o motivo da correção' }, { status: 400 })
  }

  const { data: conversa, error } = await supabaseAdmin
    .from('wa_conversas')
    .select('id, contato:wa_contatos!inner (id, fornecedor_id)')
    .eq('id', id)
    .maybeSingle()
  if (error || !conversa) return NextResponse.json({ erro: 'Conversa não encontrada' }, { status: 404 })

  const bruto = (conversa as { contato: unknown }).contato
  const contato = (Array.isArray(bruto) ? bruto[0] : bruto) as { fornecedor_id: string | null }
  if (!contato?.fornecedor_id) {
    return NextResponse.json({ erro: 'Este contato não tem cadastro de confecção — não há o que corrigir.' }, { status: 409 })
  }

  const r = await reclassificarFornecedor({
    fornecedorId: contato.fornecedor_id,
    para,
    motivo,
    por: 'admin',
  })
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: 409 })

  return NextResponse.json({ ok: true, para })
}
