// app/api/pedido/assistente/[id]/mockup/route.ts
// POST — salva (merge) o mockup de uma linha no pedido, pra não regerar ao
// reabrir o visualizador. Body:
//   { index, liso?, arte? }  → grava/atualiza a linha (null remove o campo)
//   { resetAll: true }       → zera o mapa (usado ao excluir/reindexar)
// Acesso por uuid do pedido (mesmo padrão público do visualizador).
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { z } from 'zod'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BodySchema = z.object({
  index: z.number().int().min(0).max(199).optional(),
  liso: z.string().nullable().optional(),
  arte: z.string().nullable().optional(),
  fotos: z.array(z.string()).max(6).nullable().optional(),
  ia: z.array(z.object({ url: z.string(), prompt: z.string().optional() })).max(8).nullable().optional(),
  resetAll: z.boolean().optional(),
})

type Ctx = { params: Promise<{ id: string }> }
type MapaMockups = Record<string, { liso?: string; arte?: string; fotos?: string[]; ia?: { url: string; prompt?: string }[] }>

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  let bruto: unknown
  try { bruto = await req.json() } catch { return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 }) }
  const p = BodySchema.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: 'Body inválido' }, { status: 400 })

  const { data: row } = await supabase
    .from('pedidos_assistente')
    .select('mockups')
    .eq('id', id)
    .maybeSingle<{ mockups: MapaMockups | null }>()
  if (!row) return NextResponse.json({ erro: 'Pedido não encontrado' }, { status: 404 })

  let mapa: MapaMockups = (row.mockups && typeof row.mockups === 'object') ? { ...row.mockups } : {}

  if (p.data.resetAll) {
    mapa = {}
  } else if (typeof p.data.index === 'number') {
    const k = String(p.data.index)
    const atual = mapa[k] ?? {}
    const novo: { liso?: string; arte?: string; fotos?: string[]; ia?: { url: string; prompt?: string }[] } = { ...atual }
    if (p.data.liso !== undefined) { if (p.data.liso === null) delete novo.liso; else novo.liso = p.data.liso }
    if (p.data.arte !== undefined) { if (p.data.arte === null) delete novo.arte; else novo.arte = p.data.arte }
    if (p.data.fotos !== undefined) {
      if (!p.data.fotos || p.data.fotos.length === 0) delete novo.fotos
      else novo.fotos = p.data.fotos
      // ao usar o novo modelo de múltiplas fotos, descarta o campo legado liso/arte
      delete novo.liso; delete novo.arte
    }
    if (p.data.ia !== undefined) {
      if (!p.data.ia || p.data.ia.length === 0) delete novo.ia
      else novo.ia = p.data.ia
    }
    if (Object.keys(novo).length === 0 || (!novo.liso && !novo.arte && (!novo.fotos || novo.fotos.length === 0) && (!novo.ia || novo.ia.length === 0))) delete mapa[k]
    else mapa[k] = novo
  } else {
    return NextResponse.json({ erro: 'Informe index ou resetAll' }, { status: 400 })
  }

  const { error } = await supabase
    .from('pedidos_assistente')
    .update({ mockups: mapa, atualizado_em: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
