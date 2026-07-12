// GET /api/fornecedor/melhorenvio/status?oferta=<id> → { conectado }
// Consulta usada pela calculadora de frete antes de cotar.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { fornecedorConectado, melhorEnvioConfigurado } from '@/app/lib/melhorenvio'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ofertaId = req.nextUrl.searchParams.get('oferta')
  if (!ofertaId) return NextResponse.json({ erro: 'oferta ausente' }, { status: 400 })

  const { data } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('fornecedor_id')
    .eq('id', ofertaId)
    .maybeSingle<{ fornecedor_id: string }>()
  if (!data) return NextResponse.json({ erro: 'Oferta não encontrada' }, { status: 404 })

  const conectado = melhorEnvioConfigurado() && (await fornecedorConectado(data.fornecedor_id))
  return NextResponse.json({ ok: true, conectado, configurado: melhorEnvioConfigurado() })
}
