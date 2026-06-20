// app/api/pedido/assistente/[id]/pagar/route.ts
// ============================================================================
// POST — gera a cobrança (ASAAS) do ORÇAMENTO FINAL definido pelo fornecedor.
// Só funciona com orcamento_status='definido' e valor_centavos > 0 — o valor
// vem do banco (definido pelo fornecedor), nunca do cliente.
// Idempotente: cobrança já existente é devolvida; se o fornecedor reajustou o
// orçamento depois (valor divergiu) e ainda não foi paga, atualiza no ASAAS.
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { criarCobrancaPixPedido, atualizarValorCobrancaPix } from '@/app/lib/pedido-pagamento'
import { enviarEmailPedidoPix } from '@/app/lib/email-pedido'
import { apenasDigitos } from '@/app/lib/cpf-cnpj'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BodySchema = z.object({ cpfCnpj: z.string().min(8) })

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ erro: 'id ausente' }, { status: 400 })

  let bruto: unknown
  try { bruto = await req.json() } catch { return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 }) }
  const p = BodySchema.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: 'Dados inválidos' }, { status: 400 })

  const cpf = apenasDigitos(p.data.cpfCnpj)
  if (cpf.length !== 11 && cpf.length !== 14) {
    return NextResponse.json({ erro: 'CPF/CNPJ inválido.' }, { status: 400 })
  }

  const { data: pedido, error: errPedido } = await supabase
    .from('pedidos_assistente')
    .select('id, nome, email, telefone, asaas_payment_id, pix_copia_cola, pix_link, valor_centavos, pagamento_status, orcamento_status, linhas, imagens, mockups')
    .eq('id', id)
    .maybeSingle<{
      id: string
      nome: string | null
      email: string | null
      telefone: string | null
      asaas_payment_id: string | null
      pix_copia_cola: string | null
      pix_link: string | null
      valor_centavos: number | null
      pagamento_status: string | null
      orcamento_status: string | null
      linhas: unknown[]
      imagens: unknown[] | null
      mockups: import('@/app/lib/pedido-visuais').MapaMockups | null
    }>()
  if (errPedido || !pedido) return NextResponse.json({ erro: 'Pedido não encontrado.' }, { status: 404 })

  if (pedido.orcamento_status !== 'definido' || !pedido.valor_centavos || pedido.valor_centavos <= 0) {
    return NextResponse.json(
      { erro: 'O orçamento final ainda não foi definido pelo fornecedor.' },
      { status: 409 }
    )
  }

  // idempotência: cobrança já existe → devolve; se o orçamento foi reajustado
  // (valor da cobrança divergiu) e ainda não foi paga, atualiza no ASAAS.
  if (pedido.asaas_payment_id && pedido.pix_copia_cola) {
    return NextResponse.json({
      ok: true,
      jaExistia: true,
      copiaCola: pedido.pix_copia_cola,
      invoiceUrl: pedido.pix_link,
      valorCentavos: pedido.valor_centavos,
    })
  }
  if (pedido.asaas_payment_id && !pedido.pix_copia_cola) {
    // cobrança existe mas sem QR salvo — tenta atualizar/rebuscar
    try {
      const upd = await atualizarValorCobrancaPix(pedido.asaas_payment_id, pedido.valor_centavos)
      await supabase
        .from('pedidos_assistente')
        .update({ pix_copia_cola: upd.copiaCola, pix_qr_imagem: upd.qrImagem, pix_link: upd.invoiceUrl, atualizado_em: new Date().toISOString() })
        .eq('id', id)
      return NextResponse.json({ ok: true, jaExistia: true, copiaCola: upd.copiaCola, invoiceUrl: upd.invoiceUrl, valorCentavos: pedido.valor_centavos })
    } catch (err) {
      console.error('[pagar] rebusca de cobrança falhou:', err)
    }
  }

  // gera a cobrança com o valor FINAL do fornecedor
  let pix
  try {
    pix = await criarCobrancaPixPedido({
      pedidoId: id,
      nome: pedido.nome ?? 'Cliente Confeccione',
      email: pedido.email,
      whatsapp: pedido.telefone,
      cpfCnpj: cpf,
      valorCentavos: pedido.valor_centavos,
    })
  } catch (err) {
    console.error('[pagar] falha ao gerar cobrança:', err)
    return NextResponse.json({ erro: 'Não foi possível gerar a cobrança agora. Tente de novo.' }, { status: 502 })
  }

  await supabase
    .from('pedidos_assistente')
    .update({
      cpf_cnpj: cpf,
      asaas_customer_id: pix.customerId,
      asaas_payment_id: pix.paymentId,
      pix_copia_cola: pix.copiaCola,
      pix_qr_imagem: pix.qrImagem,
      pix_link: pix.invoiceUrl,
      pagamento_status: 'gerado',
      atualizado_em: new Date().toISOString(),
    })
    .eq('id', id)

  // e-mail com a cobrança (best-effort)
  if (pedido.email) {
    try {
      await enviarEmailPedidoPix({
        id,
        email: pedido.email,
        nome: pedido.nome,
        totalCentavos: pedido.valor_centavos,
        copiaCola: pix.copiaCola,
        invoiceUrl: pix.invoiceUrl,
        linhas: (Array.isArray(pedido.linhas) ? pedido.linhas : []) as Parameters<typeof enviarEmailPedidoPix>[0]['linhas'],
        numImagens: (await import('@/app/lib/pedido-visuais')).coletarVisuaisPedido(pedido.mockups, pedido.imagens).length,
      })
    } catch (err) {
      console.error('[pagar] email falhou:', err)
    }
  }

  return NextResponse.json({
    ok: true,
    copiaCola: pix.copiaCola,
    invoiceUrl: pix.invoiceUrl,
    valorCentavos: pedido.valor_centavos,
  })
}
