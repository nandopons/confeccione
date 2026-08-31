// app/api/pedido/assistente/[id]/arquivo/route.ts
// ============================================================================
// GET ?f=<sha>.<ext> → serve um arquivo do pedido guardado no bucket.
//
// Existe porque o <img src> do navegador não resolve `storage:...`. O servidor
// traduz a referência numa URL desta rota (refParaUrl) e aqui ela vira bytes.
//
// ESCOPO: o arquivo é sempre lido de `pedidos/<id do pedido>/<f>`, com o id
// vindo da própria rota. O parâmetro `f` só aceita <32 hex>.<ext> — sem barra,
// sem "..", sem subir de pasta. Não há como pedir arquivo de outro pedido nem
// de outra pasta do bucket por aqui.
//
// Acesso por uuid do pedido, igual às rotas irmãs (imagem, mockup-thumb): quem
// tem o link do pedido vê as imagens dele.
// ============================================================================
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { caminhoDoArquivo } from '@/app/lib/imagens-pedido-storage'
import { BUCKET_ARTES } from '@/app/lib/arquivos-cliente'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

const TIPO_POR_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml',
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const arquivo = req.nextUrl.searchParams.get('f') ?? ''

  const caminho = caminhoDoArquivo(id, arquivo)
  if (!caminho) return NextResponse.json({ erro: 'Arquivo inválido' }, { status: 400 })

  const { data, error } = await supabaseAdmin.storage.from(BUCKET_ARTES).download(caminho)
  if (error || !data) return NextResponse.json({ erro: 'Não encontrado' }, { status: 404 })

  const bytes = Buffer.from(await data.arrayBuffer())
  const ext = arquivo.split('.').pop()?.toLowerCase() ?? ''

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': TIPO_POR_EXT[ext] ?? data.type ?? 'application/octet-stream',
      // O nome do arquivo é o hash do conteúdo: mudou o conteúdo, mudou a URL.
      // Por isso dá pra cachear com folga sem servir imagem velha.
      'Cache-Control': 'private, max-age=86400, immutable',
    },
  })
}
