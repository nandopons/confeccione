// app/api/admin/mockups/route.ts
// ============================================================================
// CRUD do repositório de mockups lisos (tabela mockups_lisos), só admin.
//   GET    → lista metadados (sem o data URL, que é pesado)
//   POST   → adiciona OU substitui (upsert pela chave modelo|cor|material)
//   DELETE → remove por ?chave=...
//
// Defesa em profundidade: middleware já barra /api/admin/*; revalidamos o
// cookie aqui (ehTokenAdminValido).
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { chaveMockup, normMockup } from '@/app/lib/mockup-cache'

export const runtime = 'nodejs'

const MAX_IMG_BYTES = 8 * 1024 * 1024

function naoAutorizado(req: NextRequest): boolean {
  return !ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)
}

export async function GET(req: NextRequest) {
  if (naoAutorizado(req)) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })

  const { data, error } = await supabaseAdmin
    .from('mockups_lisos')
    .select('chave, modelo, cor, material, criado_em')
    .order('criado_em', { ascending: false })

  if (error) {
    console.error('[admin/mockups] GET erro:', error)
    return NextResponse.json({ erro: 'Erro ao listar' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, mockups: data ?? [] })
}

const PostSchema = z.object({
  modelo: z.string().min(1),
  cor: z.string().min(1),
  material: z.string().nullable().optional(),
  imagemDataUrl: z.string().min(1),
})

export async function POST(req: NextRequest) {
  if (naoAutorizado(req)) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })

  let bruto: unknown
  try {
    bruto = await req.json()
  } catch {
    return NextResponse.json({ erro: 'Body inválido' }, { status: 400 })
  }
  const parsed = PostSchema.safeParse(bruto)
  if (!parsed.success) {
    return NextResponse.json({ erro: 'Informe modelo, cor e a imagem.' }, { status: 400 })
  }

  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(parsed.data.imagemDataUrl.trim())
  if (!m) {
    return NextResponse.json({ erro: 'Imagem deve ser um data URL (data:image/...;base64,...).' }, { status: 400 })
  }
  const aprox = Math.floor((m[2].length * 3) / 4)
  if (aprox > MAX_IMG_BYTES) {
    return NextResponse.json({ erro: 'Imagem grande demais (máx. 8 MB).' }, { status: 400 })
  }

  const chave = chaveMockup(parsed.data.modelo, parsed.data.cor, parsed.data.material)

  const { error } = await supabaseAdmin.from('mockups_lisos').upsert(
    {
      chave,
      modelo: normMockup(parsed.data.modelo) || null,
      cor: normMockup(parsed.data.cor) || null,
      material: normMockup(parsed.data.material) || null,
      imagem_data_url: parsed.data.imagemDataUrl,
      criado_em: new Date().toISOString(),
    },
    { onConflict: 'chave' }
  )

  if (error) {
    console.error('[admin/mockups] POST erro:', error)
    return NextResponse.json({ erro: 'Erro ao salvar' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, chave })
}

export async function DELETE(req: NextRequest) {
  if (naoAutorizado(req)) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })

  const chave = req.nextUrl.searchParams.get('chave')
  if (!chave) return NextResponse.json({ erro: 'chave ausente' }, { status: 400 })

  const { error } = await supabaseAdmin.from('mockups_lisos').delete().eq('chave', chave)
  if (error) {
    console.error('[admin/mockups] DELETE erro:', error)
    return NextResponse.json({ erro: 'Erro ao excluir' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
