// GET /api/fornecedor/melhorenvio/status?oferta=<id>
//   → { conectado, configurado, estimativaDisponivel, cepOrigem }
// Consulta usada pela calculadora de frete antes de cotar. `estimativaDisponivel`
// diz se dá pra cotar sem a conta dela (pela conta da plataforma); `cepOrigem`
// é o do cadastro, pra vir preenchido.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { fornecedorConectado, melhorEnvioConfigurado, tokenDaPlataforma } from '@/app/lib/melhorenvio'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ofertaId = req.nextUrl.searchParams.get('oferta')
  if (!ofertaId) return NextResponse.json({ erro: 'oferta ausente' }, { status: 400 })

  const { data } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('fornecedor_id, leads_fornecedores(cep)')
    .eq('id', ofertaId)
    .maybeSingle<{ fornecedor_id: string; leads_fornecedores: { cep: string | null } | { cep: string | null }[] | null }>()
  if (!data) return NextResponse.json({ erro: 'Oferta não encontrada' }, { status: 404 })

  const configurado = melhorEnvioConfigurado()
  const [conectado, tokenPlataforma] = await Promise.all([
    configurado ? fornecedorConectado(data.fornecedor_id) : Promise.resolve(false),
    configurado ? tokenDaPlataforma() : Promise.resolve(null),
  ])
  const lead = Array.isArray(data.leads_fornecedores) ? data.leads_fornecedores[0] : data.leads_fornecedores
  const cep = (lead?.cep ?? '').replace(/\D/g, '')

  return NextResponse.json({
    ok: true,
    conectado,
    configurado,
    estimativaDisponivel: Boolean(tokenPlataforma),
    cepOrigem: cep.length === 8 ? cep : null,
  })
}
