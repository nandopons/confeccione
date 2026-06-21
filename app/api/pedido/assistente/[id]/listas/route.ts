// GET  /api/pedido/assistente/[id]/listas  → todas as listas do pedido + inscritos
// POST /api/pedido/assistente/[id]/listas  → cria/garante a lista de um modelo
// Público por uuid (mesmo padrão do visualizador/entrega).
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import crypto from 'crypto'
import { garantirLidLinha, resolverIndiceDaLista } from '@/app/lib/listas-externas'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type Ctx = { params: Promise<{ id: string }> }

function corLabel(s?: string | null): string {
  return (s || '').replace(/\s*\(#?[0-9a-fA-F]{6}\)\s*/g, ' ').replace(/#[0-9a-fA-F]{6}/g, '').replace(/\s{2,}/g, ' ').trim()
}

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ erro: 'id ausente' }, { status: 400 })

  const { data: listasRaw } = await supabase
    .from('listas_externas')
    .select('id, pedido_id, linha_index, modelo_nome, cor, titulo, token, ativa, criado_em, lid')
    .eq('pedido_id', id)
    .order('linha_index', { ascending: true })

  // mantém linha_index em dia com a posição atual do modelo (resolve por lid)
  const listas = listasRaw ?? []
  for (const l of listas) {
    try { await resolverIndiceDaLista(supabase, l as { id: string; pedido_id: string; linha_index: number; lid?: string | null }) } catch { /* noop */ }
  }

  const { data: insc } = await supabase
    .from('inscricoes_externas')
    .select('id, lista_id, nome, tamanho, numero, observacao, whatsapp, email, criado_em')
    .eq('pedido_id', id)
    .order('criado_em', { ascending: true })

  const porLista: Record<string, unknown[]> = {}
  for (const r of insc ?? []) {
    const k = (r as { lista_id: string }).lista_id
    ;(porLista[k] ??= []).push(r)
  }
  const out = (listas ?? []).map((l) => ({ ...l, inscritos: porLista[l.id] ?? [] }))
  return NextResponse.json({ listas: out })
}

const Body = z.object({
  linha_index: z.number().int().min(0),
  titulo: z.string().max(120).nullable().optional(),
})

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ erro: 'id ausente' }, { status: 400 })

  let bruto: unknown
  try { bruto = await req.json() } catch { return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 }) }
  const p = Body.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: 'Dados inválidos' }, { status: 400 })

  // já existe lista para esse modelo? devolve ela
  const { data: existente } = await supabase
    .from('listas_externas')
    .select('id, pedido_id, linha_index, modelo_nome, cor, titulo, token, ativa, criado_em')
    .eq('pedido_id', id)
    .eq('linha_index', p.data.linha_index)
    .maybeSingle()
  if (existente) return NextResponse.json({ lista: { ...existente, inscritos: [] } })

  // snapshot do modelo/cor a partir do pedido
  const { data: ped } = await supabase.from('pedidos_assistente').select('linhas').eq('id', id).single()
  const linhas = Array.isArray(ped?.linhas) ? (ped!.linhas as Record<string, unknown>[]) : []
  const l = linhas[p.data.linha_index] as { modelo?: string | null; cor?: string | null } | undefined
  const token = crypto.randomBytes(9).toString('base64url')
  const lid = await garantirLidLinha(supabase, id, p.data.linha_index)

  const { data: nova, error } = await supabase
    .from('listas_externas')
    .insert({
      pedido_id: id,
      linha_index: p.data.linha_index,
      lid,
      modelo_nome: l?.modelo ?? null,
      cor: corLabel(l?.cor) || null,
      titulo: p.data.titulo?.trim() || null,
      token,
      ativa: true,
    })
    .select('id, pedido_id, linha_index, modelo_nome, cor, titulo, token, ativa, criado_em')
    .single()
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 })
  return NextResponse.json({ lista: { ...nova, inscritos: [] } })
}
