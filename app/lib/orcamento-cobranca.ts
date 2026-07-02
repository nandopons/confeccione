// app/lib/orcamento-cobranca.ts
// ============================================================================
// Gera a cobrança ASAAS de um ORÇAMENTO avulso do admin (/admin/orcamentos).
//
// Espelha pedido-pagamento.ts: cria/reaproveita o customer pelo CPF/CNPJ e
// abre cobrança billingType PIX (pura — sem opção de cartão) com DESCONTO
// DE 3% até o vencimento. Como o único método é PIX, o desconto é
// efetivamente "só no PIX". Não persiste — quem grava é a rota
// /api/admin/orcamentos.
// ============================================================================

import { asaasFetch, centavosParaReais } from './asaas'
import { apenasDigitos } from './cpf-cnpj'

export const DESCONTO_PIX_PERCENTUAL = 3

async function criarOuObterCustomer(nome: string, cpfCnpj: string): Promise<string> {
  const cpf = apenasDigitos(cpfCnpj)
  const personType = cpf.length === 11 ? 'FISICA' : 'JURIDICA'

  // reusa customer existente com o mesmo CPF/CNPJ (evita duplicar no ASAAS)
  try {
    const existente = await asaasFetch<{ data: Array<{ id: string }> }>('/customers', {
      query: { cpfCnpj: cpf },
    })
    if (existente.data && existente.data.length > 0) return existente.data[0].id
  } catch {
    // se a busca falhar, tenta criar
  }

  const c = await asaasFetch<{ id: string }>('/customers', {
    method: 'POST',
    body: {
      name: nome,
      cpfCnpj: cpf,
      personType,
      notificationDisabled: true,
    },
  })
  return c.id
}

export type CobrancaOrcamento = {
  customerId: string
  paymentId: string
  invoiceUrl: string
  copiaCola: string | null
  qrImagem: string | null // PNG base64 (sem prefixo data:)
  vencimento: string // YYYY-MM-DD
}

export async function criarCobrancaOrcamento(input: {
  orcamentoId: string
  numero: string
  nome: string
  cpfCnpj: string
  valorCentavos: number
  /** YYYY-MM-DD; default: hoje + 7 dias */
  vencimento?: string | null
}): Promise<CobrancaOrcamento> {
  const customerId = await criarOuObterCustomer(input.nome, input.cpfCnpj)

  let vencimento = input.vencimento ?? undefined
  if (!vencimento) {
    const d = new Date()
    d.setDate(d.getDate() + 7)
    vencimento = d.toISOString().slice(0, 10)
  }

  const payment = await asaasFetch<{ id: string; invoiceUrl: string }>('/payments', {
    method: 'POST',
    body: {
      customer: customerId,
      billingType: 'PIX', // PIX puro — sem cartão; o desconto abaixo só existe no PIX
      value: centavosParaReais(input.valorCentavos),
      dueDate: vencimento,
      description: `Confeccione - Orçamento ${input.numero}`,
      externalReference: input.orcamentoId,
      // 3% de desconto pra pagamento até o vencimento.
      discount: {
        value: DESCONTO_PIX_PERCENTUAL,
        type: 'PERCENTAGE',
        dueDateLimitDays: 0,
      },
    },
  })

  let copiaCola: string | null = null
  let qrImagem: string | null = null
  try {
    const pix = await asaasFetch<{ payload: string; encodedImage: string }>(
      `/payments/${payment.id}/pixQrCode`
    )
    copiaCola = pix.payload
    qrImagem = pix.encodedImage
  } catch (err) {
    console.error('[orcamento-cobranca] busca QR pix falhou:', err)
  }

  return {
    customerId,
    paymentId: payment.id,
    invoiceUrl: payment.invoiceUrl,
    copiaCola,
    qrImagem,
    vencimento,
  }
}
