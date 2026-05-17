// app/lib/asaas-payments.ts
// ============================================================================
// Cobranças avulsas (Pix/Boleto/Cartão) — usadas pra pacotes de leads extras.
// Não são recorrentes — uma cobrança = um pagamento esperado.
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import { ASAAS_BILLING_TYPE, asaasFetch, centavosParaReais, type MetodoPagamento } from './asaas'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export type AsaasBillingType = 'PIX' | 'BOLETO' | 'CREDIT_CARD' | 'UNDEFINED'

export type AsaasPayment = {
  id: string                   // pay_xxxxxxxxxxxx
  customer: string             // cus_xxxxxxxxxxxx
  subscription?: string        // sub_xxxxxxxxxxxx (só se for fatura de assinatura)
  value: number                // valor em reais (com decimais)
  netValue: number
  billingType: AsaasBillingType
  status: AsaasPaymentStatus
  dueDate: string              // YYYY-MM-DD
  invoiceUrl: string           // checkout pra cliente abrir
  bankSlipUrl?: string         // só pra boleto
  pixTransaction?: string
  dateCreated: string
}

export type AsaasPaymentStatus =
  | 'PENDING'
  | 'RECEIVED'
  | 'CONFIRMED'
  | 'OVERDUE'
  | 'REFUNDED'
  | 'RECEIVED_IN_CASH'
  | 'REFUND_REQUESTED'
  | 'CHARGEBACK_REQUESTED'
  | 'CHARGEBACK_DISPUTE'
  | 'AWAITING_CHARGEBACK_REVERSAL'
  | 'DUNNING_REQUESTED'
  | 'DUNNING_RECEIVED'
  | 'AWAITING_RISK_ANALYSIS'
  | 'DELETED'

/**
 * Mapeia tipo do pacote → preço em centavos por plano do fornecedor.
 * Espelha PACOTES_LEADS_EXTRAS de planos.ts.
 */
export const PRECO_PACOTES_CENTAVOS: Record<
  'pacote_leads_5' | 'pacote_leads_10' | 'pacote_leads_25',
  Record<'free' | 'starter' | 'pro', number>
> = {
  pacote_leads_5: {
    free: 7500,        // 5 × R$ 15
    starter: 6000,     // 5 × R$ 12
    pro: 5000,         // 5 × R$ 10
  },
  pacote_leads_10: {
    free: 15000,
    starter: 12000,
    pro: 10000,
  },
  pacote_leads_25: {
    free: 37500,
    starter: 30000,
    pro: 25000,
  },
}

export type CriarCobrancaPacoteInput = {
  fornecedorId: string
  asaasCustomerId: string
  tipo: 'pacote_leads_5' | 'pacote_leads_10' | 'pacote_leads_25'
  valorCentavos: number
  metodo: MetodoPagamento
  /** YYYY-MM-DD; default: hoje + 3 dias */
  vencimento?: string
}

/**
 * Cria uma cobrança avulsa no Asaas para um pacote de leads.
 * Salva o registro em pagamentos_asaas com status='pendente'.
 * Retorna o link de checkout pro cliente abrir.
 */
export async function criarCobrancaPacote(
  input: CriarCobrancaPacoteInput
): Promise<{
  paymentId: string
  linkPagamento: string
  qrCodePix: string | null
  qrCodePixImagem: string | null
  vencimento: string
}> {
  const dueDate = input.vencimento ?? defaultDueDate()

  const payment = await asaasFetch<AsaasPayment>('/payments', {
    method: 'POST',
    body: {
      customer: input.asaasCustomerId,
      billingType: ASAAS_BILLING_TYPE[input.metodo],
      value: centavosParaReais(input.valorCentavos),
      dueDate,
      description: descricaoPacote(input.tipo),
      externalReference: input.fornecedorId,
    },
  })

  // Pra Pix, busca o QR code: payload (copia-cola) + encodedImage (PNG base64)
  let qrCodePix: string | null = null
  let qrCodePixImagem: string | null = null
  if (input.metodo === 'pix') {
    try {
      const pix = await asaasFetch<{ payload: string; encodedImage: string }>(
        `/payments/${payment.id}/pixQrCode`
      )
      qrCodePix = pix.payload
      qrCodePixImagem = pix.encodedImage
    } catch (err) {
      console.error('[asaas-payments] busca QR code pix falhou:', err)
    }
  }

  // Registra no banco local
  await supabase.from('pagamentos_asaas').insert({
    fornecedor_id: input.fornecedorId,
    asaas_payment_id: payment.id,
    tipo: input.tipo,
    valor_centavos: input.valorCentavos,
    metodo: input.metodo,
    status: 'pendente',
    link_pagamento: payment.invoiceUrl,
    qr_code_pix: qrCodePix,
    qr_code_pix_imagem: qrCodePixImagem,
    vencimento: dueDate,
  })

  return {
    paymentId: payment.id,
    linkPagamento: payment.invoiceUrl,
    qrCodePix,
    qrCodePixImagem,
    vencimento: dueDate,
  }
}

function defaultDueDate(): string {
  const d = new Date()
  d.setDate(d.getDate() + 3)
  return d.toISOString().slice(0, 10)
}

function descricaoPacote(
  tipo: 'pacote_leads_5' | 'pacote_leads_10' | 'pacote_leads_25'
): string {
  const qtd = tipo === 'pacote_leads_5' ? 5 : tipo === 'pacote_leads_10' ? 10 : 25
  return `Confeccione - Pacote de ${qtd} pedidos extras`
}

/**
 * Busca uma cobrança no Asaas (útil pra reconciliar status).
 */
export async function buscarCobranca(asaasPaymentId: string): Promise<AsaasPayment> {
  return await asaasFetch<AsaasPayment>(`/payments/${asaasPaymentId}`)
}

/**
 * Mapeia status do Asaas → status interno (pagamentos_asaas.status).
 * Failure-soft: status desconhecido cai pra 'pendente'.
 */
export function mapearStatusAsaas(
  status: AsaasPaymentStatus
):
  | 'pendente'
  | 'pago'
  | 'vencido'
  | 'estornado'
  | 'cancelado' {
  if (status === 'RECEIVED' || status === 'CONFIRMED' || status === 'RECEIVED_IN_CASH') {
    return 'pago'
  }
  if (status === 'OVERDUE' || status === 'DUNNING_REQUESTED' || status === 'DUNNING_RECEIVED') {
    return 'vencido'
  }
  if (
    status === 'REFUNDED' ||
    status === 'REFUND_REQUESTED' ||
    status === 'CHARGEBACK_REQUESTED' ||
    status === 'CHARGEBACK_DISPUTE'
  ) {
    return 'estornado'
  }
  if (status === 'DELETED') {
    return 'cancelado'
  }
  return 'pendente'
}
