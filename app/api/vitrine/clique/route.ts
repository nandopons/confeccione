// app/api/vitrine/clique/route.ts
// POST { item } — registra o clique num card da vitrine (sendBeacon do botão
// "Fazer pedido"). Sem dado pessoal: produto, confecção, hora. Ver
// vitrine_cliques e BotaoPedidoVitrine.
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/app/lib/supabase-server'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  let item: string | null = null
  try {
    const j = (await req.json()) as { item?: unknown }
    item = typeof j.item === 'string' && /^[0-9a-f-]{36}$/i.test(j.item) ? j.item : null
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  if (!item) return NextResponse.json({ ok: false }, { status: 400 })
  const { data } = await supabaseAdmin.from('portfolio_fornecedores').select('fornecedor_id').eq('id', item).maybeSingle<{ fornecedor_id: string }>()
  if (!data) return NextResponse.json({ ok: false }, { status: 404 })
  await supabaseAdmin.from('vitrine_cliques').insert({ item_id: item, fornecedor_id: data.fornecedor_id })
  return NextResponse.json({ ok: true })
}
