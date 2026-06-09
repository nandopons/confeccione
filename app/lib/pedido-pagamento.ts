// app/lib/pedido-pagamento.ts
// ============================================================================
// Gera a cobrança PIX (ASAAS) de um PEDIDO de cliente (pedidos_assistente).
// Cria/reaproveita o customer no ASAAS pelo CPF/CNPJ e abre a cobrança PIX.
// Não persiste — quem grava é a rota /confirmar.
// ============================================================================

import { asaasFetch, centavosParaReais } from './asaas'
import { apenasDigitos } from './cpf-cnpj'

// ASAAS espera telefone BR sem DDI (DDD + número, 10-11 dígitos). O telefone é
// guardado como 55+DDD+número (E.164) — aqui tiramos o 55 pra não bugar a
// validação do ASAAS.
function telefoneAsaas(w: string | null | undefined): string | undefined {
  if (!w) return undefined
  let d = apenasDigitos(w)
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2)
  return d.length >= 10 && d.length <= 11 ? d : undefined
}

async function criarOuObterCustomer(input: {
  nome: string
  email: string | null
  whatsapp: string | null
  cpfCnpj: string
}): Promise<string> {
  const cpf = apenasDigitos(input.cpfCnpj)
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
      name: input.nome,
      email: input.email || undefined,
      mobilePhone: telefoneAsaas(input.whatsapp),
      cpfCnpj: cpf,
      personType,
      notificationDisabled: true,
    },
  })
  return c.id
}

export type CobrancaPix = {
  customerId: string
  paymentId: string
  invoiceUrl: string
  copiaCola: string | null
  qrImagem: string | null // PNG base64 (sem prefixo data:)
  vencimento: string
}

export async function criarCobrancaPixPedido(input: {
  pedidoId: string
  nome: string
  email: string | null
  whatsapp: string | null
  cpfCnpj: string
  valorCentavos: number
}): Promise<CobrancaPix> {
  const customerId = await criarOuObterCustomer(input)

  const d = new Date()
  d.setDate(d.getDate() + 3)
  const vencimento = d.toISOString().slice(0, 10)

  const payment = await asaasFetch<{ id: string; invoiceUrl: string }>('/payments', {
    method: 'POST',
    body: {
      customer: customerId,
      billingType: 'UNDEFINED', // deixa o cliente escolher PIX ou cartão no checkout ASAAS
      value: centavosParaReais(input.valorCentavos),
      dueDate: vencimento,
      description: `Pedido Confeccione ${input.pedidoId.slice(0, 8)}`,
      externalReference: input.pedidoId,
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
    console.error('[pedido-pagamento] busca QR pix falhou:', err)
  }

  return { customerId, paymentId: payment.id, invoiceUrl: payment.invoiceUrl, copiaCola, qrImagem, vencimento }
}
