// PATCH  /api/pedido/assistente/[id]/listas/[listaId] → ativa/fecha ou renomeia
// DELETE /api/pedido/assistente/[id]/listas/[listaId] → remove a lista (e inscrições)
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { z } from 'zod'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type Ctx = { params: Promise<{ id: string; listaId: string }> }

const Body = z.object({
  ativa: z.boolean().optional(),
  titulo: z.string().max(120).nullable().optional(),
})

export async function PATCH(req: Request, ctx: Ctx) {
  const { id, listaId } = await ctx.params
  let bruto: unknown
  try { bruto = await req.json() } catch { return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 }) }
  const p = Body.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: 'Dados inválidos' }, { status: 400 })

  const patch: Record<string, unknown> = { atualizado_em: new Date().toISOString() }
  if (typeof p.data.ativa === 'boolean') patch.ativa = p.data.ativa
  if (p.data.titulo !== undefined) patch.titulo = p.data.titulo?.trim() || null

  const { error } = await supabase
    .from('listas_externas')
    .update(patch)
    .eq('id', listaId)
    .eq('pedido_id', id)
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id, listaId } = await ctx.params
  const { error } = await supabase
    .from('listas_externas')
    .delete()
    .eq('id', listaId)
    .eq('pedido_id', id)
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
