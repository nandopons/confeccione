// app/api/admin/precos/produtos/route.ts
// CRUD dos preços base por modelo+material (com faixas de quantidade). Só admin.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { normMockup } from '@/app/lib/mockup-cache'

export const runtime = 'nodejs'

function negar(req: NextRequest) {
  return !ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)
}

export async function GET(req: NextRequest) {
  if (negar(req)) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  const { data, error } = await supabaseAdmin
    .from('precos_produtos')
    .select('id, chave, modelo, material, faixas, atualizado_em')
    .order('modelo', { ascending: true })
  if (error) return NextResponse.json({ erro: 'Erro ao listar' }, { status: 500 })
  return NextResponse.json({ ok: true, produtos: data ?? [] })
}

const FaixaSchema = z.object({
  qtd_min: z.number().int().min(1),
  preco_centavos: z.number().int().min(0),
})
const PostSchema = z.object({
  modelo: z.string().min(1),
  material: z.string().nullable().optional(),
  faixas: z.array(FaixaSchema).min(1),
})

export async function POST(req: NextRequest) {
  if (negar(req)) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  let bruto: unknown
  try { bruto = await req.json() } catch { return NextResponse.json({ erro: 'Body inválido' }, { status: 400 }) }
  const p = PostSchema.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: 'Informe modelo e ao menos uma faixa de quantidade.' }, { status: 400 })

  const chave = `${normMockup(p.data.modelo)}|${normMockup(p.data.material)}`
  const faixas = [...p.data.faixas].sort((a, b) => a.qtd_min - b.qtd_min)

  const { error } = await supabaseAdmin.from('precos_produtos').upsert(
    {
      chave,
      modelo: normMockup(p.data.modelo),
      material: normMockup(p.data.material) || null,
      faixas,
      atualizado_em: new Date().toISOString(),
    },
    { onConflict: 'chave' }
  )
  if (error) return NextResponse.json({ erro: 'Erro ao salvar' }, { status: 500 })
  return NextResponse.json({ ok: true, chave })
}

export async function DELETE(req: NextRequest) {
  if (negar(req)) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  const chave = req.nextUrl.searchParams.get('chave')
  if (!chave) return NextResponse.json({ erro: 'chave ausente' }, { status: 400 })
  const { error } = await supabaseAdmin.from('precos_produtos').delete().eq('chave', chave)
  if (error) return NextResponse.json({ erro: 'Erro ao excluir' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
