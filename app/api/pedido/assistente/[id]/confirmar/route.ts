// app/api/pedido/assistente/[id]/confirmar/route.ts
// ============================================================================
// POST — confirma o pedido: valida CPF, RECALCULA o total no servidor (não
// confia no cliente), gera a cobrança PIX no ASAAS, salva imagens + dados de
// pagamento, e dispara o e-mail com resumo + imagens + preço + PIX.
// Idempotente: se o pedido já tem PIX gerado, devolve o existente (não recobra).
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { calcularOrcamento, type PesquisaPreco } from '@/app/lib/orcamento'
import { criarCobrancaPixPedido } from '@/app/lib/pedido-pagamento'
import { enviarEmailPedidoPix } from '@/app/lib/email-pedido'
import { apenasDigitos } from '@/app/lib/cpf-cnpj'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const MAX_IMGS = 12
const MAX_TOTAL_BYTES = 25 * 1024 * 1024

const EstampaSchema = z.object({ posicao: z.string(), tamanho: z.string() })
const TamanhoSchema = z.object({ tamanho: z.string(), qtd: z.number().int().positive().nullable() })
const LinhaSchema = z.object({
  modelo: z.string().nullable(),
  cor: z.string().nullable(),
  material: z.string().nullable(),
  total: z.number().int().positive().nullable(),
  tamanhos: z.array(TamanhoSchema).default([]),
  estampas: z.array(EstampaSchema).default([]),
  descricao: z.string().nullable().optional(),
})
const BodySchema = z.object({
  cpfCnpj: z.string().min(8),
  linhas: z.array(LinhaSchema).min(1),
  imagens: z.array(z.string()).max(MAX_IMGS).default([]),
})

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

  // pedido
  const { data: pedido, error: errPedido } = await supabase
    .from('pedidos_assistente')
    .select('id, nome, email, telefone, asaas_payment_id, pix_copia_cola, pix_link, valor_centavos, pagamento_status')
    .eq('id', id)
    .maybeSingle()
  if (errPedido || !pedido) return NextResponse.json({ erro: 'Pedido não encontrado.' }, { status: 404 })

  // idempotência: já tem PIX gerado → devolve o existente
  if (pedido.asaas_payment_id && pedido.pix_copia_cola) {
    return NextResponse.json({
      ok: true,
      jaExistia: true,
      copiaCola: pedido.pix_copia_cola,
      invoiceUrl: pedido.pix_link,
      valorCentavos: pedido.valor_centavos,
    })
  }

  // recalcula o total no servidor (não confia no cliente)
  const { data: pesqData } = await supabase.from('pesquisas_preco').select('chave, faixas')
  const orcamento = calcularOrcamento(
    p.data.linhas.map((l) => ({ modelo: l.modelo, material: l.material, total: l.total, estampas: l.estampas })),
    (pesqData ?? []) as PesquisaPreco[]
  )
  if (!orcamento.completo || orcamento.total_centavos <= 0) {
    return NextResponse.json({ erro: 'Estimativa incompleta — há itens sem preço cadastrado. Não é possível gerar o PIX.' }, { status: 409 })
  }

  // valida tamanho das imagens
  const totalBytes = p.data.imagens.reduce((acc, d) => {
    const m = /;base64,(.+)$/.exec(d)
    return acc + (m ? Math.floor((m[1].length * 3) / 4) : 0)
  }, 0)
  if (totalBytes > MAX_TOTAL_BYTES) {
    return NextResponse.json({ erro: 'Imagens grandes demais.' }, { status: 400 })
  }

  // gera a cobrança PIX
  let pix
  try {
    pix = await criarCobrancaPixPedido({
      pedidoId: id,
      nome: pedido.nome ?? 'Cliente Confeccione',
      email: pedido.email,
      whatsapp: pedido.telefone,
      cpfCnpj: cpf,
      valorCentavos: orcamento.total_centavos,
    })
  } catch (err) {
    console.error('[confirmar] falha ao gerar PIX:', err)
    return NextResponse.json({ erro: 'Não foi possível gerar o PIX agora. Tente de novo.' }, { status: 502 })
  }

  // grava no pedido
  await supabase
    .from('pedidos_assistente')
    .update({
      cpf_cnpj: cpf,
      asaas_customer_id: pix.customerId,
      asaas_payment_id: pix.paymentId,
      valor_centavos: orcamento.total_centavos,
      pix_copia_cola: pix.copiaCola,
      pix_qr_imagem: pix.qrImagem,
      pix_link: pix.invoiceUrl,
      pagamento_status: 'gerado',
      status: 'confirmado',
      linhas: p.data.linhas,
      imagens: p.data.imagens,
      atualizado_em: new Date().toISOString(),
    })
    .eq('id', id)

  // e-mail (não bloqueia o sucesso se falhar)
  if (pedido.email) {
    try {
      await enviarEmailPedidoPix({
        id,
        email: pedido.email,
        nome: pedido.nome,
        totalCentavos: orcamento.total_centavos,
        copiaCola: pix.copiaCola,
        invoiceUrl: pix.invoiceUrl,
        linhas: p.data.linhas,
        numImagens: p.data.imagens.length,
      })
    } catch (err) {
      console.error('[confirmar] email falhou:', err)
    }
  }

  return NextResponse.json({
    ok: true,
    copiaCola: pix.copiaCola,
    invoiceUrl: pix.invoiceUrl,
    valorCentavos: orcamento.total_centavos,
    emailEnviado: !!pedido.email,
  })
}
