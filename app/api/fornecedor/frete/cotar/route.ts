// POST /api/fornecedor/frete/cotar — cotação Melhor Envio pro orçamento.
// Body: { ofertaId, volumes: [{ altura, largura, comprimento, peso }], seguroCentavos }
// Origem = CEP do fornecedor (cadastro); destino = CEP do pedido do cliente.
// Usa o token DO fornecedor (preço real da conta dele). Acesso por uuid da
// oferta ACEITA — mesmo padrão capability da página de orçamento.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { cotarFrete } from '@/app/lib/melhorenvio'

export const runtime = 'nodejs'
export const maxDuration = 30

const VolumeSchema = z.object({
  altura: z.number().min(0.4).max(150),
  largura: z.number().min(8).max(150),
  comprimento: z.number().min(13).max(150),
  peso: z.number().min(0.01).max(300),
})
const BodySchema = z.object({
  ofertaId: z.string().uuid(),
  volumes: z.array(VolumeSchema).min(1).max(20),
  seguroCentavos: z.number().int().min(0).default(0),
})

export async function POST(req: Request) {
  let bruto: unknown
  try { bruto = await req.json() } catch { return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 }) }
  const p = BodySchema.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: p.error.issues[0]?.message ?? 'Dados inválidos' }, { status: 400 })

  const { data: oferta } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('id, fornecedor_id, pedido_id, status')
    .eq('id', p.data.ofertaId)
    .maybeSingle<{ id: string; fornecedor_id: string; pedido_id: string; status: string }>()
  if (!oferta || oferta.status !== 'aceita') {
    return NextResponse.json({ erro: 'Oferta não encontrada ou não aceita.' }, { status: 404 })
  }

  const [{ data: fornecedor }, { data: pedido }] = await Promise.all([
    supabaseAdmin.from('leads_fornecedores').select('cep').eq('id', oferta.fornecedor_id).maybeSingle<{ cep: string | null }>(),
    supabaseAdmin.from('pedidos_assistente').select('cep').eq('id', oferta.pedido_id).maybeSingle<{ cep: string | null }>(),
  ])

  const cepOrigem = (fornecedor?.cep ?? '').replace(/\D/g, '')
  const cepDestino = (pedido?.cep ?? '').replace(/\D/g, '')
  if (cepOrigem.length !== 8) {
    return NextResponse.json({ erro: 'Seu cadastro está sem CEP — fale com a Confeccione pra atualizar.' }, { status: 409 })
  }
  if (cepDestino.length !== 8) {
    return NextResponse.json({ erro: 'O pedido do cliente está sem CEP de entrega.' }, { status: 409 })
  }

  const r = await cotarFrete({
    fornecedorId: oferta.fornecedor_id,
    cepOrigem,
    cepDestino,
    volumes: p.data.volumes,
    seguroCentavos: p.data.seguroCentavos,
  })
  if (!r.ok) return NextResponse.json({ erro: r.erro, reconectar: r.reconectar ?? false }, { status: 502 })

  return NextResponse.json({ ok: true, servicos: r.servicos, cepOrigem, cepDestino })
}
