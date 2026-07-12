// GET /api/fornecedor/melhorenvio/conectar?oferta=<id>&voltar=<path>
// Inicia o OAuth do Melhor Envio pro FORNECEDOR. Identificação em 2 modos:
// - ?oferta=<uuid> → resolve o fornecedor da oferta (mesmo modelo capability
//   da página de orçamento, que não exige sessão);
// - sem oferta → exige sessão de fornecedor (painel).
// O vínculo volta no `state` assinado (HMAC com o client secret, 15 min).
import { NextRequest, NextResponse } from 'next/server'
import { getFornecedorAtual } from '@/app/lib/auth-server'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { gerarState, melhorEnvioConfigurado, urlAutorizacao } from '@/app/lib/melhorenvio'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!melhorEnvioConfigurado()) {
    return NextResponse.json({ erro: 'Integração Melhor Envio não configurada.' }, { status: 503 })
  }

  const ofertaId = req.nextUrl.searchParams.get('oferta')
  const voltar = req.nextUrl.searchParams.get('voltar') ?? '/fornecedor/painel/envio'

  let fornecedorId: string | null = null
  if (ofertaId) {
    const { data } = await supabaseAdmin
      .from('ofertas_pedido_assistente')
      .select('fornecedor_id')
      .eq('id', ofertaId)
      .maybeSingle<{ fornecedor_id: string }>()
    fornecedorId = data?.fornecedor_id ?? null
  } else {
    const sessao = await getFornecedorAtual()
    fornecedorId = sessao?.id ?? null
  }
  if (!fornecedorId) return NextResponse.json({ erro: 'Fornecedor não identificado.' }, { status: 401 })

  return NextResponse.redirect(urlAutorizacao(gerarState(fornecedorId, voltar)))
}
