// app/api/fornecedor/oferta/[id]/linhas/route.ts
// PATCH { linhas: LinhaEditada[] } — o FORNECEDOR que aceitou edita os produtos
// do pedido (material, cor, grade, observação, adicionar/remover) pela página
// pública da oferta. Acesso pelo uuid da oferta (mesmo modelo do /responder).
// Só com oferta 'aceita' e pedido ainda não pago. Edição vale na hora: o
// cliente é avisado pelo WhatsApp oficial; se já havia orçamento 'definido',
// ele volta pra 'aguardando_fornecedor' e o fornecedor precisa reenviar.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { avisarClienteEdicaoFornecedor, salvarLinhasEditadas } from '@/app/lib/pedido-linhas-edicao'

export const runtime = 'nodejs'
type Ctx = { params: Promise<{ id: string }> }

const TamanhoSchema = z.object({ tamanho: z.string().max(20).nullable().optional(), qtd: z.number().int().min(0).nullable().optional() })
const LinhaSchema = z.object({
  lid: z.string().max(64).nullable().optional(),
  origIdx: z.number().int().min(0).nullable().optional(),
  modelo: z.string().max(120).nullable().optional(),
  cor: z.string().max(120).nullable().optional(),
  material: z.string().max(160).nullable().optional(),
  total: z.number().int().min(0).nullable().optional(),
  tamanhos: z.array(TamanhoSchema).max(40).nullable().optional(),
  descricao: z.string().max(1000).nullable().optional(),
})
const BodySchema = z.object({ linhas: z.array(LinhaSchema).min(1).max(60) })

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  let bruto: unknown
  try { bruto = await req.json() } catch { return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 }) }
  const p = BodySchema.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: 'Formato inválido' }, { status: 400 })

  const { data: oferta } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('id, pedido_id, status, fornecedor_id, leads_fornecedores(nome)')
    .eq('id', id)
    .maybeSingle<{ id: string; pedido_id: string; status: string; fornecedor_id: string; leads_fornecedores: { nome: string | null } | null }>()
  if (!oferta) return NextResponse.json({ erro: 'Oferta não encontrada' }, { status: 404 })
  if (oferta.status !== 'aceita') return NextResponse.json({ erro: 'Só quem assumiu o pedido pode editar os produtos.' }, { status: 409 })

  const r = await salvarLinhasEditadas({
    pedidoId: oferta.pedido_id,
    linhas: p.data.linhas,
    autor: 'fornecedor',
    fornecedorId: oferta.fornecedor_id,
    ofertaId: oferta.id,
  })
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })

  let avisado = false
  if (r.mudou) {
    avisado = await avisarClienteEdicaoFornecedor({
      pedidoId: oferta.pedido_id,
      fornecedorNome: oferta.leads_fornecedores?.nome ?? null,
      resumo: r.resumo,
      orcamentoReaberto: r.orcamentoReaberto,
    })
  }
  return NextResponse.json({ ok: true, mudou: r.mudou, orcamentoReaberto: r.orcamentoReaberto, avisado, linhas: r.linhas })
}
