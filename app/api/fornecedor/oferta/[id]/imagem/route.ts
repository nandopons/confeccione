// app/api/fornecedor/oferta/[id]/imagem/route.ts
// ============================================================================
// POST multipart "file" → sobe UMA foto pra pasta do pedido e devolve a
// referência + a URL de exibição. É o upload do editor de itens da confecção
// (25/09/2026): a foto entra no rascunho da linha na hora em que ela escolhe o
// arquivo, mas só passa a ser "da peça" quando ela confirma o ajuste
// (PATCH /linhas ou POST /orcamento, campo `imagens` de cada linha).
//
// Por que uma foto por requisição, e não junto do PATCH: a função da Vercel
// aceita 4,5 MB de corpo. Três fotos de celular em base64 dentro do JSON do
// ajuste estouravam isso sem aviso útil. Aqui cada foto viaja sozinha,
// já redimensionada no navegador (≤1600 px), e o PATCH leva só referências.
//
// Foto que sobe e a confecção desiste de confirmar fica órfã no bucket. Não
// aponta pra nada, não aparece pra ninguém, e é reaproveitada pelo hash se ela
// mandar de novo. Limpeza é assunto de rotina, não deste caminho.
//
// Acesso por uuid da oferta ACEITA e pedido não pago — igual ao /portfolio.
// ============================================================================
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { guardarBytes, refParaUrl } from '@/app/lib/imagens-pedido-storage'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_BYTES = 10 * 1024 * 1024
const MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const { data: oferta, error: eOferta } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('id, status, pedido_id, pedidos_assistente(pagamento_status)')
    .eq('id', id)
    .maybeSingle<{ id: string; status: string; pedido_id: string; pedidos_assistente: { pagamento_status: string | null } | { pagamento_status: string | null }[] | null }>()
  if (eOferta) return NextResponse.json({ erro: 'Não deu pra ler a oferta agora.' }, { status: 500 })
  if (!oferta) return NextResponse.json({ erro: 'Oferta não encontrada' }, { status: 404 })
  if (oferta.status !== 'aceita') return NextResponse.json({ erro: 'Só quem assumiu o pedido pode mexer nas fotos.' }, { status: 409 })
  const ped = Array.isArray(oferta.pedidos_assistente) ? oferta.pedidos_assistente[0] : oferta.pedidos_assistente
  if (ped?.pagamento_status === 'pago') return NextResponse.json({ erro: 'Pedido já pago — não dá mais pra alterar.' }, { status: 409 })

  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ erro: 'Requisição inválida' }, { status: 400 }) }
  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ erro: 'Nenhum arquivo enviado' }, { status: 400 })
  const mime = (file.type || '').toLowerCase()
  if (!MIMES.has(mime)) return NextResponse.json({ erro: 'Envie uma imagem (JPG, PNG ou WebP).' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ erro: 'Imagem muito grande (máx. 10 MB).' }, { status: 413 })

  const bytes = Buffer.from(await file.arrayBuffer())
  const ref = await guardarBytes(bytes, mime, oferta.pedido_id)
  if (!ref) return NextResponse.json({ erro: 'Não consegui guardar a imagem agora. Tente de novo.' }, { status: 502 })

  return NextResponse.json({ ok: true, ref, url: refParaUrl(ref, oferta.pedido_id) })
}
