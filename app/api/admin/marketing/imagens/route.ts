// POST /api/admin/marketing/imagens  (multipart/form-data, campo "file")
// Sobe logo/imagem de e-mail pro bucket PÚBLICO 'marketing' e devolve a URL.
// Público de propósito: cliente de e-mail baixa a imagem sem cookie e sem
// token, então URL assinada não funcionaria.
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUCKET = 'marketing'
const MAX_BYTES = 5 * 1024 * 1024
const TIPOS = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']

export async function POST(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ erro: 'Requisição inválida' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ erro: 'Nenhuma imagem enviada' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ erro: 'Imagem acima de 5 MB' }, { status: 413 })
  }
  if (!TIPOS.includes(file.type)) {
    return NextResponse.json({ erro: 'Formato não aceito. Use PNG, JPG, GIF, WEBP ou SVG.' }, { status: 415 })
  }

  const ext = (file.name.split('.').pop() ?? 'png').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5)
  const caminho = `email/${randomUUID()}.${ext || 'png'}`

  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(caminho, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false })
  if (error) {
    return NextResponse.json({ erro: `Falha no upload: ${error.message}` }, { status: 500 })
  }

  const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(caminho)
  return NextResponse.json({ ok: true, url: data.publicUrl })
}
