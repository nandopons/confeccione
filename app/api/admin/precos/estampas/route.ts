// app/api/admin/precos/estampas/route.ts
// CRUD dos preços de estampa por posição+tamanho. Só admin.
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
    .from('precos_estampas')
    .select('id, chave, posicao, tamanho, preco_centavos, criado_em')
    .order('posicao', { ascending: true })
  if (error) return NextResponse.json({ erro: 'Erro ao listar' }, { status: 500 })
  return NextResponse.json({ ok: true, estampas: data ?? [] })
}

const PostSchema = z.object({
  posicao: z.string().min(1),
  tamanho: z.string().min(1),
  preco_centavos: z.number().int().min(0),
})

export async function POST(req: NextRequest) {
  if (negar(req)) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  let bruto: unknown
  try { bruto = await req.json() } catch { return NextResponse.json({ erro: 'Body inválido' }, { status: 400 }) }
  const p = PostSchema.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: 'Informe posição, tamanho e preço.' }, { status: 400 })

  const chave = `${normMockup(p.data.posicao)}|${normMockup(p.data.tamanho)}`
  const { error } = await supabaseAdmin.from('precos_estampas').upsert(
    {
      chave,
      posicao: normMockup(p.data.posicao),
      tamanho: normMockup(p.data.tamanho),
      preco_centavos: p.data.preco_centavos,
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
  const { error } = await supabaseAdmin.from('precos_estampas').delete().eq('chave', chave)
  if (error) return NextResponse.json({ erro: 'Erro ao excluir' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
