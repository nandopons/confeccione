// app/api/admin/precos/pesquisas/route.ts
// CRUD das pesquisas de preço salvas (modelo+material+liso/estampado). Só admin.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { normMockup } from '@/app/lib/mockup-cache'

export const runtime = 'nodejs'

function negar(req: NextRequest) {
  return !ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)
}
function chave(modelo: string, material: string | null | undefined, estampado: boolean): string {
  return `${normMockup(modelo)}|${normMockup(material)}|${estampado ? 'estampado' : 'liso'}`
}

export async function GET(req: NextRequest) {
  if (negar(req)) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  const { data, error } = await supabaseAdmin
    .from('pesquisas_preco')
    .select('id, chave, modelo, material, estampado, faixas, observacao, atualizado_em')
    .order('modelo', { ascending: true })
  if (error) return NextResponse.json({ erro: 'Erro ao listar' }, { status: 500 })
  return NextResponse.json({ ok: true, pesquisas: data ?? [] })
}

const FaixaSchema = z.object({ qtd_min: z.number().int().positive(), preco_centavos: z.number().int().min(0) })
const PostSchema = z.object({
  modelo: z.string().min(1),
  material: z.string().nullable().optional(),
  estampado: z.boolean().default(false),
  faixas: z.array(FaixaSchema).min(1),
  observacao: z.string().nullable().optional(),
})

export async function POST(req: NextRequest) {
  if (negar(req)) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  let bruto: unknown
  try { bruto = await req.json() } catch { return NextResponse.json({ erro: 'Body inválido' }, { status: 400 }) }
  const p = PostSchema.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: 'Informe modelo e ao menos uma faixa.' }, { status: 400 })

  const k = chave(p.data.modelo, p.data.material, p.data.estampado)
  const faixas = [...p.data.faixas].sort((a, b) => a.qtd_min - b.qtd_min)

  const { error } = await supabaseAdmin.from('pesquisas_preco').upsert(
    {
      chave: k,
      modelo: normMockup(p.data.modelo),
      material: normMockup(p.data.material) || null,
      estampado: p.data.estampado,
      faixas,
      observacao: p.data.observacao ?? null,
      atualizado_em: new Date().toISOString(),
    },
    { onConflict: 'chave' }
  )
  if (error) return NextResponse.json({ erro: 'Erro ao salvar' }, { status: 500 })
  return NextResponse.json({ ok: true, chave: k })
}

export async function DELETE(req: NextRequest) {
  if (negar(req)) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  const k = req.nextUrl.searchParams.get('chave')
  if (!k) return NextResponse.json({ erro: 'chave ausente' }, { status: 400 })
  const { error } = await supabaseAdmin.from('pesquisas_preco').delete().eq('chave', k)
  if (error) return NextResponse.json({ erro: 'Erro ao excluir' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
