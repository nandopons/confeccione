// app/api/cliente/arquivos/[id]/download/route.ts
// ============================================================================
// GET /api/cliente/arquivos/[id]/download
//
// Baixa um arquivo do repositório do cliente logado. Ownership obrigatório
// (só baixa o que é da conta). Gera signed URL de 60s com download forçado
// usando o nome amigável (display_name), e redireciona pra ela — o browser
// baixa direto com Content-Disposition: attachment.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { getContaAtual } from '@/app/lib/cliente-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { BUCKET_ARTES } from '@/app/lib/arquivos-cliente'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const conta = await getContaAtual()
  if (!conta) {
    return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  }

  const { id } = await params

  // Ownership: só baixa arquivo que pertence à conta autenticada.
  const { data: arquivo } = await supabaseAdmin
    .from('arquivos_cliente')
    .select('storage_path, display_name')
    .eq('id', id)
    .eq('conta_id', conta.id)
    .maybeSingle<{ storage_path: string; display_name: string }>()

  if (!arquivo) {
    return NextResponse.json({ erro: 'Arquivo não encontrado' }, { status: 404 })
  }

  // download: display_name → Content-Disposition attachment com nome amigável
  // (não expõe o storage_path interno com UUID).
  const { data: signed, error } = await supabaseAdmin.storage
    .from(BUCKET_ARTES)
    .createSignedUrl(arquivo.storage_path, 60, { download: arquivo.display_name })

  if (error || !signed) {
    console.error('[arquivos/download] signed URL falhou:', error)
    return NextResponse.json({ erro: 'Erro ao gerar link' }, { status: 500 })
  }

  return NextResponse.redirect(signed.signedUrl)
}
