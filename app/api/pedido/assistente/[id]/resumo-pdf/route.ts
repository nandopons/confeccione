// GET /api/pedido/assistente/[id]/resumo-pdf — PDF com o resumo do pedido,
// com a marca da Confeccione. Público por uuid (mesmo padrão do visualizador).
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { gerarResumoPedidoPdf, type ResumoPedido } from '@/app/lib/resumo-pdf'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const { data } = await supabase
    .from('pedidos_assistente')
    .select('id, nome, linhas, prazo_dias, cep, numero, complemento, logradouro, bairro, cidade, uf, mockups, imagens')
    .eq('id', id)
    .maybeSingle<any>()
  if (!data) return NextResponse.json({ erro: 'Pedido não encontrado' }, { status: 404 })

  const pedido: ResumoPedido = {
    id: data.id,
    nome: data.nome,
    linhas: Array.isArray(data.linhas) ? data.linhas : [],
    prazoDias: data.prazo_dias ?? null,
    cep: data.cep, numero: data.numero, complemento: data.complemento,
    logradouro: data.logradouro, bairro: data.bairro, cidade: data.cidade, uf: data.uf,
    mockups: data.mockups ?? null,
    imagens: Array.isArray(data.imagens) ? data.imagens : null,
  }

  const bytes = await gerarResumoPedidoPdf(pedido)
  const nomeArq = `confeccione-pedido-${data.id.slice(0, 8)}.pdf`
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${nomeArq}"`,
      'Cache-Control': 'no-store',
    },
  })
}
