// app/lib/asaas-subscriptions.ts
// ============================================================================
// Assinaturas recorrentes — usadas pra upgrade de plano (Starter/Pro).
// Asaas gera faturas mensais automaticamente.
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import { ASAAS_BILLING_TYPE, asaasFetch, centavosParaReais, type MetodoPagamento } from './asaas'
import { PLANOS_CONFIG, type Plano } from './planos'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export type AsaasSubscription = {
  id: string                     // sub_xxxxxxxxxxxx
  customer: string
  value: number                  // valor em reais
  nextDueDate: string            // YYYY-MM-DD
  cycle: 'MONTHLY' | 'WEEKLY' | 'YEARLY'
  description: string
  status: 'ACTIVE' | 'INACTIVE' | 'EXPIRED'
  billingType: 'PIX' | 'BOLETO' | 'CREDIT_CARD' | 'UNDEFINED'
  dateCreated: string
}

export type CriarAssinaturaInput = {
  fornecedorId: string
  asaasCustomerId: string
  plano: Exclude<Plano, 'free'>          // não cria assinatura pro free
  metodo: MetodoPagamento
}

const TIPO_ASSINATURA_POR_PLANO: Record<
  Exclude<Plano, 'free'>,
  'assinatura_starter' | 'assinatura_pro'
> = {
  starter: 'assinatura_starter',
  pro: 'assinatura_pro',
}

/**
 * Cria uma assinatura mensal recorrente no Asaas.
 * Asaas gera as faturas automaticamente todo mês a partir da nextDueDate.
 *
 * IMPORTANTE: este método NÃO ativa o plano localmente. A ativação acontece
 * só quando o webhook confirmar o primeiro pagamento (PAYMENT_CONFIRMED ou
 * PAYMENT_RECEIVED). Isso evita ativar plano pra fornecedor que abriu boleto
 * mas não pagou.
 *
 * Se metodo='pix', também busca o QR Code da primeira fatura via
 * GET /payments/:id/pixQrCode (mesmo padrão de criarCobrancaPacote).
 */
export async function criarAssinatura(input: CriarAssinaturaInput): Promise<{
  subscriptionId: string
  primeiraFatura: {
    paymentId: string
    linkPagamento: string
    qrCodePix: string | null
    qrCodePixImagem: string | null
    vencimento: string
  }
}> {
  const config = PLANOS_CONFIG[input.plano] ?? PLANOS_CONFIG['free']
  const valorCentavos = config.preco_mes * 100

  // Primeira fatura vence em 3 dias (dá tempo do fornecedor pagar)
  const nextDueDate = (() => {
    const d = new Date()
    d.setDate(d.getDate() + 3)
    return d.toISOString().slice(0, 10)
  })()

  const subscription = await asaasFetch<AsaasSubscription>('/subscriptions', {
    method: 'POST',
    body: {
      customer: input.asaasCustomerId,
      billingType: ASAAS_BILLING_TYPE[input.metodo],
      value: centavosParaReais(valorCentavos),
      nextDueDate,
      cycle: 'MONTHLY',
      description: `Confeccione - Plano ${config.nome}`,
      externalReference: input.fornecedorId,
    },
  })

  // Busca a primeira fatura gerada (Asaas cria automaticamente)
  const faturas = await asaasFetch<{
    data: Array<{ id: string; invoiceUrl: string; dueDate: string }>
  }>(`/subscriptions/${subscription.id}/payments`)

  const primeiraFatura = faturas.data[0]
  if (!primeiraFatura) {
    throw new Error(`Asaas não gerou primeira fatura pra assinatura ${subscription.id}`)
  }

  // Pra Pix, busca o QR code da primeira fatura: payload + encodedImage
  let qrCodePix: string | null = null
  let qrCodePixImagem: string | null = null
  if (input.metodo === 'pix') {
    try {
      const pix = await asaasFetch<{ payload: string; encodedImage: string }>(
        `/payments/${primeiraFatura.id}/pixQrCode`
      )
      qrCodePix = pix.payload
      qrCodePixImagem = pix.encodedImage
    } catch (err) {
      console.error('[asaas-subscriptions] busca QR code pix falhou:', err)
    }
  }

  // Registra no banco local
  await supabase.from('pagamentos_asaas').insert({
    fornecedor_id: input.fornecedorId,
    asaas_payment_id: primeiraFatura.id,
    asaas_subscription_id: subscription.id,
    tipo: TIPO_ASSINATURA_POR_PLANO[input.plano],
    valor_centavos: valorCentavos,
    metodo: input.metodo,
    status: 'pendente',
    link_pagamento: primeiraFatura.invoiceUrl,
    qr_code_pix: qrCodePix,
    qr_code_pix_imagem: qrCodePixImagem,
    vencimento: primeiraFatura.dueDate,
  })

  return {
    subscriptionId: subscription.id,
    primeiraFatura: {
      paymentId: primeiraFatura.id,
      linkPagamento: primeiraFatura.invoiceUrl,
      qrCodePix,
      qrCodePixImagem,
      vencimento: primeiraFatura.dueDate,
    },
  }
}

/**
 * Cancela uma assinatura no Asaas. Faturas futuras não são geradas.
 * Faturas já criadas e ainda não pagas continuam válidas (decisão do Asaas).
 */
export async function cancelarAssinatura(asaasSubscriptionId: string): Promise<void> {
  await asaasFetch(`/subscriptions/${asaasSubscriptionId}`, {
    method: 'DELETE',
  })
}

/**
 * Busca uma assinatura no Asaas.
 */
export async function buscarAssinatura(
  asaasSubscriptionId: string
): Promise<AsaasSubscription> {
  return await asaasFetch<AsaasSubscription>(`/subscriptions/${asaasSubscriptionId}`)
}

/**
 * Lista todas as assinaturas de um customer.
 */
export async function listarAssinaturasCustomer(
  asaasCustomerId: string
): Promise<AsaasSubscription[]> {
  const result = await asaasFetch<{ data: AsaasSubscription[] }>('/subscriptions', {
    query: { customer: asaasCustomerId },
  })
  return result.data
}
