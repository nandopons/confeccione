// DELETE /api/pedido/assistente/[id]/listas/[listaId]/inscricao/[inscId]
// Remove uma pessoa da lista e recalcula as quantidades do modelo.
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { recomputarLinhaDaLista } from '@/app/lib/listas-externas'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type Ctx = { params: Promise<{ id: string; listaId: string; inscId: string }> }

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id, listaId, inscId } = await ctx.params

  const { data: lista } = await supabase
    .from('listas_externas')
    .select('id, pedido_id, linha_index')
    .eq('id', listaId)
    .eq('pedido_id', id)
    .single()
  if (!lista) return NextResponse.json({ erro: 'Lista não encontrada' }, { status: 404 })

  const { error } = await supabase
    .from('inscricoes_externas')
    .delete()
    .eq('id', inscId)
    .eq('lista_id', listaId)
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 })

  await recomputarLinhaDaLista(supabase, lista)
  return NextResponse.json({ ok: true })
}
