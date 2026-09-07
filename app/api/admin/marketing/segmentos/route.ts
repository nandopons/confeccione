// GET/POST/DELETE /api/admin/marketing/segmentos — filtros salvos pra reusar
// na hora de criar campanha ("Clientes de PE", "Nunca compraram", etc).
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function autorizado(req: NextRequest): boolean {
  return ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  const { data } = await supabaseAdmin
    .from('segmentos_marketing')
    .select('id, nome, filtro, criado_em')
    .order('nome')
  return NextResponse.json({ segmentos: data ?? [] })
}

const Novo = z.object({ nome: z.string().trim().min(2).max(60), filtro: z.record(z.string(), z.unknown()) })

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  const parsed = Novo.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ erro: 'Dados inválidos' }, { status: 400 })
  const { error } = await supabaseAdmin
    .from('segmentos_marketing')
    .upsert({ nome: parsed.data.nome, filtro: parsed.data.filtro }, { onConflict: 'nome' })
  if (error) return NextResponse.json({ erro: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ erro: 'id obrigatório' }, { status: 400 })
  await supabaseAdmin.from('segmentos_marketing').delete().eq('id', id)
  return NextResponse.json({ ok: true })
}
