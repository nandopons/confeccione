// app/api/fornecedor/oferta/[id]/ficha-pdf/route.ts
// ============================================================================
// GET → a FICHA TÉCNICA do pedido pra confecção que assumiu: o mesmo PDF do
// resumo, com o bloco "Dados do cliente" (nome, CPF/CNPJ, e-mail, telefone,
// endereço completo) no lugar do "acompanhe seu pedido no painel".
//
// Por que uma rota própria (30/09/2026): o aviso de aceite mandava à confecção
// o link do /api/pedido/assistente/[id]/resumo-pdf, que é o PDF do CLIENTE,
// público por uuid do pedido — sem e-mail, sem CPF, com o convite pro painel
// do cliente. O Fernando: "quando o fornecedor aceita o pedido não tá vindo
// várias infos, como e-mail do cliente, CPF". Dado de cliente só sai pra
// quem ASSUMIU, então o acesso é por uuid da oferta ACEITA — o mesmo critério
// do /imagem e do /portfolio desta pasta. Oferta ofertada, recusada ou
// cancelada não vê nada além do que a página da oferta já mostra.
// ============================================================================
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { gerarResumoPedidoPdf, type ResumoPedido } from '@/app/lib/resumo-pdf'

export const runtime = 'nodejs'
export const maxDuration = 60

type Ctx = { params: Promise<{ id: string }> }

type Pedido = {
  id: string
  codigo: string | null
  nome: string | null
  telefone: string | null
  email: string | null
  cpf_cnpj: string | null
  linhas: unknown
  prazo_dias: number | null
  cep: string | null
  numero: string | null
  complemento: string | null
  logradouro: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  observacoes: string | null
  mockups: ResumoPedido['mockups']
  imagens: unknown
}

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const { data: oferta, error } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('id, status, pedido_id')
    .eq('id', id)
    .maybeSingle<{ id: string; status: string; pedido_id: string }>()
  if (error) return NextResponse.json({ erro: 'Não deu pra ler a oferta agora.' }, { status: 500 })
  if (!oferta) return NextResponse.json({ erro: 'Oferta não encontrada' }, { status: 404 })
  if (oferta.status !== 'aceita') return NextResponse.json({ erro: 'A ficha completa fica disponível pra quem assumiu o pedido.' }, { status: 409 })

  const { data } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, codigo, nome, telefone, email, cpf_cnpj, linhas, prazo_dias, cep, numero, complemento, logradouro, bairro, cidade, uf, observacoes, mockups, imagens')
    .eq('id', oferta.pedido_id)
    .maybeSingle<Pedido>()
  if (!data) return NextResponse.json({ erro: 'Pedido não encontrado' }, { status: 404 })

  const pedido: ResumoPedido = {
    id: data.id,
    nome: data.nome,
    linhas: Array.isArray(data.linhas) ? (data.linhas as ResumoPedido['linhas']) : [],
    prazoDias: data.prazo_dias ?? null,
    observacoes: data.observacoes ?? null,
    cep: data.cep, numero: data.numero, complemento: data.complemento,
    logradouro: data.logradouro, bairro: data.bairro, cidade: data.cidade, uf: data.uf,
    codigo: data.codigo ?? null,
    mockups: data.mockups ?? null,
    imagens: Array.isArray(data.imagens) ? data.imagens : null,
    paraConfeccao: { telefone: data.telefone, email: data.email, cpfCnpj: data.cpf_cnpj },
  }

  const bytes = await gerarResumoPedidoPdf(pedido)
  const nomeArq = `confeccione-ficha-${data.id.slice(0, 8)}.pdf`
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${nomeArq}"`,
      'Cache-Control': 'no-store',
    },
  })
}
