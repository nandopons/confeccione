// Público (uuid da oferta): serve a mídia i do portfólio do orçamento via
// signed URL (range/stream do próprio Storage). Usado pelo cliente e pelo
// fornecedor pra visualizar fotos/vídeos.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { BUCKET_ARTES, carregarOfertaPortfolio } from '@/app/lib/orcamento-portfolio'

export const runtime = 'nodejs'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; i: string }> }) {
  const { id, i } = await ctx.params
  const idx = parseInt(i, 10)
  if (!Number.isFinite(idx) || idx < 0) return NextResponse.json({ erro: 'Índice inválido' }, { status: 400 })

  const oferta = await carregarOfertaPortfolio(id)
  if (!oferta) return NextResponse.json({ erro: 'Não encontrado' }, { status: 404 })
  const midia = oferta.midias[idx]
  if (!midia) return NextResponse.json({ erro: 'Não encontrado' }, { status: 404 })

  const { data: signed, error } = await supabaseAdmin.storage
    .from(BUCKET_ARTES)
    .createSignedUrl(midia.path, 3600)
  if (error || !signed) return NextResponse.json({ erro: 'Erro ao gerar link' }, { status: 500 })
  return NextResponse.redirect(signed.signedUrl)
}
