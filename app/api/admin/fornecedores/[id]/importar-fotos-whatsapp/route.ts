// app/api/admin/fornecedores/[id]/importar-fotos-whatsapp/route.ts
// ============================================================================
// POST — puxa pro portfólio TODAS as fotos que a confecção já mandou pelo
// WhatsApp e ainda não estão lá. Botão pra acervo antigo: desde 29/09/2026 a
// foto nova entra sozinha no turno em que chega (ver guardarFotosDaConversa).
// Caso de origem: o Joaquim (Your Soul Wear) mandou 113 fotos antes da regra.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { guardarFotosDaConversa } from '@/app/lib/portfolio-fornecedor'

export const runtime = 'nodejs'
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: Ctx) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  }
  const { id } = await ctx.params
  const { data: contatos } = await supabaseAdmin.from('wa_contatos').select('id').eq('fornecedor_id', id)
  const contatoIds = ((contatos ?? []) as Array<{ id: string }>).map((c) => c.id)
  if (contatoIds.length === 0) return NextResponse.json({ ok: true, conversas: 0, guardadas: 0, observacao: 'nenhuma conversa de WhatsApp ligada a esse fornecedor' })
  const { data: conversas } = await supabaseAdmin.from('wa_conversas').select('id').in('contato_id', contatoIds)
  let guardadas = 0
  let jaTinha = 0
  const erros: string[] = []
  for (const c of (conversas ?? []) as Array<{ id: string }>) {
    const r = await guardarFotosDaConversa(id, c.id, { max: 150 })
    guardadas += r.guardadas
    jaTinha += r.jaTinha
    erros.push(...r.erros)
  }
  return NextResponse.json({ ok: true, conversas: (conversas ?? []).length, guardadas, ja_estavam: jaTinha, erros: erros.slice(0, 5) })
}
