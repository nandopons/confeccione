// Portfólio do orçamento (lado FORNECEDOR). Acesso por uuid da oferta aceita.
//   POST   multipart "file"  → sobe 1 mídia (imagem/vídeo) e anexa à oferta
//   DELETE ?path=...         → remove 1 mídia
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import {
  BUCKET_ARTES,
  PORTFOLIO_PREFIX,
  PORTFOLIO_MAX_ITENS,
  PORTFOLIO_MAX_BYTES,
  carregarOfertaPortfolio,
  tipoDaMime,
  sanitizeNome,
  type PortfolioMidia,
} from '@/app/lib/orcamento-portfolio'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const oferta = await carregarOfertaPortfolio(id)
  if (!oferta) return NextResponse.json({ erro: 'Oferta não encontrada' }, { status: 404 })
  if (oferta.status !== 'aceita') return NextResponse.json({ erro: 'Oferta não está ativa' }, { status: 409 })
  if (oferta.pedidoPago) return NextResponse.json({ erro: 'Pedido já pago — não dá pra alterar' }, { status: 409 })
  if (oferta.midias.length >= PORTFOLIO_MAX_ITENS) {
    return NextResponse.json({ erro: `Limite de ${PORTFOLIO_MAX_ITENS} arquivos atingido` }, { status: 409 })
  }

  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ erro: 'Requisição inválida' }, { status: 400 }) }
  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ erro: 'Nenhum arquivo enviado' }, { status: 400 })
  }
  const tipo = tipoDaMime(file.type)
  if (!tipo) return NextResponse.json({ erro: 'Envie apenas imagens ou vídeos' }, { status: 400 })
  if (file.size > PORTFOLIO_MAX_BYTES) {
    return NextResponse.json({ erro: 'Arquivo muito grande (máx. 30MB)' }, { status: 413 })
  }

  const storagePath = `${PORTFOLIO_PREFIX}/${id}/${randomUUID()}_${sanitizeNome(file.name)}`
  const contentType = file.type || 'application/octet-stream'
  const buffer = Buffer.from(await file.arrayBuffer())
  const { error: errUp } = await supabaseAdmin.storage
    .from(BUCKET_ARTES)
    .upload(storagePath, buffer, { contentType, upsert: false })
  if (errUp) {
    console.error('[portfolio/upload] storage falhou:', errUp)
    return NextResponse.json({ erro: 'Erro ao salvar arquivo' }, { status: 500 })
  }

  const nova: PortfolioMidia = { path: storagePath, mime: file.type || null, tipo, nome: sanitizeNome(file.name) }
  const midias = [...oferta.midias, nova]
  const { error: errUpd } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .update({ portfolio_midias: midias })
    .eq('id', id)
  if (errUpd) {
    await supabaseAdmin.storage.from(BUCKET_ARTES).remove([storagePath])
    return NextResponse.json({ erro: 'Erro ao registrar arquivo' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, midias })
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const path = req.nextUrl.searchParams.get('path') || ''
  const oferta = await carregarOfertaPortfolio(id)
  if (!oferta) return NextResponse.json({ erro: 'Oferta não encontrada' }, { status: 404 })
  if (oferta.pedidoPago) return NextResponse.json({ erro: 'Pedido já pago — não dá pra alterar' }, { status: 409 })

  // Só remove paths que pertencem a esta oferta (defensivo).
  if (!path.startsWith(`${PORTFOLIO_PREFIX}/${id}/`)) {
    return NextResponse.json({ erro: 'Arquivo inválido' }, { status: 400 })
  }
  const midias = oferta.midias.filter((m) => m.path !== path)
  await supabaseAdmin.storage.from(BUCKET_ARTES).remove([path]).catch(() => {})
  const { error } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .update({ portfolio_midias: midias })
    .eq('id', id)
  if (error) return NextResponse.json({ erro: 'Erro ao remover' }, { status: 500 })
  return NextResponse.json({ ok: true, midias })
}
