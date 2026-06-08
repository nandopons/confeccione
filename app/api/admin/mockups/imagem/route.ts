// app/api/admin/mockups/imagem/route.ts
// ============================================================================
// GET /api/admin/mockups/imagem?chave=... → devolve a imagem do mockup (bytes),
// decodificada do data URL guardado. Permite <img src> sem trafegar base64 na
// listagem. Só admin.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  const chave = req.nextUrl.searchParams.get('chave')
  if (!chave) return NextResponse.json({ erro: 'chave ausente' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('mockups_lisos')
    .select('imagem_data_url')
    .eq('chave', chave)
    .maybeSingle()

  if (error || !data?.imagem_data_url) {
    return NextResponse.json({ erro: 'Não encontrado' }, { status: 404 })
  }

  const m = /^data:([^;,]+);base64,(.+)$/.exec(data.imagem_data_url)
  if (!m) return NextResponse.json({ erro: 'Imagem inválida' }, { status: 500 })

  const bytes = Buffer.from(m[2], 'base64')
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': m[1],
      'Cache-Control': 'private, max-age=60',
    },
  })
}
