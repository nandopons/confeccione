// app/api/asaas/webhook/route.ts
// ============================================================================
// Webhook do Asaas — recebe eventos de pagamento e atualiza estado interno.
// Configurado em https://sandbox.asaas.com → Integrações → Webhooks.
//
// Eventos esperados:
// - PAYMENT_CREATED, PAYMENT_UPDATED
// - PAYMENT_CONFIRMED (cartão), PAYMENT_RECEIVED (Pix/Boleto)
// - PAYMENT_OVERDUE, PAYMENT_DELETED, PAYMENT_REFUNDED
//
// Validação: header asaas-access-token deve bater com ASAAS_WEBHOOK_TOKEN.
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { mapearStatusAsaas, type AsaasPaymentStatus } from '@/app/lib/asaas-payments'
import { PLANOS_CONFIG, creditarLoteAvulso, type Plano } from '@/app/lib/planos'
import { enviarMensagem } from '@/app/lib/zapi'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type AsaasWebhookPayload = {
  event: string
  payment?: {
    id: string
    customer: string
    subscription?: string
    value: number
    status: AsaasPaymentStatus
    billingType: string
    dueDate: string
    paymentDate?: string
    externalReference?: string
  }
}

export async function POST(req: Request) {
  // ============================================================
  // 1. Validação de autenticação
  // ============================================================
  const tokenEsperado = process.env.ASAAS_WEBHOOK_TOKEN
  if (!tokenEsperado) {
    console.error('[asaas-webhook] ASAAS_WEBHOOK_TOKEN não configurado no env')
    return NextResponse.json({ error: 'webhook não configurado' }, { status: 500 })
  }

  const tokenRecebido = req.headers.get('asaas-access-token')
  if (tokenRecebido !== tokenEsperado) {
    console.warn('[asaas-webhook] token inválido recebido')
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // ============================================================
  // 2. Parse do payload
  // ============================================================
  let payload: AsaasWebhookPayload
  try {
    payload = (await req.json()) as AsaasWebhookPayload
  } catch (err) {
    console.error('[asaas-webhook] payload inválido:', err)
    return NextResponse.json({ error: 'payload inválido' }, { status: 400 })
  }

  // Log pra debug
  await supabase.from('asaas_webhook_debug').insert({ payload }).single().then(
    () => undefined,
    () => undefined // ignora erro se tabela não existir (opcional)
  )

  if (!payload.payment || !payload.event) {
    return NextResponse.json({ ok: true, ignorado: 'sem payment ou event' })
  }

  const { payment, event } = payload

  // ============================================================
  // 3. Tratamento por evento
  // ============================================================
  // Eventos que afetam status de pagamento:
  if (
    event === 'PAYMENT_CONFIRMED' ||
    event === 'PAYMENT_RECEIVED' ||
    event === 'PAYMENT_OVERDUE' ||
    event === 'PAYMENT_DELETED' ||
    event === 'PAYMENT_REFUNDED' ||
    event === 'PAYMENT_UPDATED'
  ) {
    const novoStatus = mapearStatusAsaas(payment.status)

    // Atualiza pagamento local
    const { data: pagamentoAtualizado, error: errUpd } = await supabase
      .from('pagamentos_asaas')
      .update({
        status: novoStatus,
        pago_em: novoStatus === 'pago' && payment.paymentDate
          ? new Date(payment.paymentDate).toISOString()
          : null,
      })
      .eq('asaas_payment_id', payment.id)
      .select('id, fornecedor_id, tipo, asaas_subscription_id')
      .maybeSingle()

    if (errUpd) {
      console.error('[asaas-webhook] update pagamento falhou:', errUpd)
      return NextResponse.json({ error: 'erro ao atualizar' }, { status: 500 })
    }

    if (!pagamentoAtualizado) {
      // Pagamento não existe localmente — provavelmente criado direto no painel Asaas
      console.warn(
        `[asaas-webhook] pagamento ${payment.id} não encontrado localmente, ignorando`
      )
      return NextResponse.json({ ok: true, ignorado: 'pagamento desconhecido' })
    }

    // Se foi pago: aplicar efeito (lote de avulsos ou ativar plano)
    if (novoStatus === 'pago') {
      await aplicarEfeitoPagamento({
        fornecedorId: pagamentoAtualizado.fornecedor_id,
        pagamentoId: pagamentoAtualizado.id,
        tipo: pagamentoAtualizado.tipo as TipoCobranca,
        asaasSubscriptionId: pagamentoAtualizado.asaas_subscription_id,
      })
    }
  }

  return NextResponse.json({ ok: true, event, paymentId: payment.id })
}

// ============================================================
// Helpers
// ============================================================

type TipoCobranca =
  | 'pacote_leads_5'
  | 'pacote_leads_10'
  | 'pacote_leads_25'
  | 'assinatura_starter'
  | 'assinatura_pro'

const QUANTIDADE_LEADS_POR_PACOTE: Record<
  'pacote_leads_5' | 'pacote_leads_10' | 'pacote_leads_25',
  number
> = {
  pacote_leads_5: 5,
  pacote_leads_10: 10,
  pacote_leads_25: 25,
}

const PLANO_POR_ASSINATURA: Record<
  'assinatura_starter' | 'assinatura_pro',
  Plano
> = {
  assinatura_starter: 'starter',
  assinatura_pro: 'pro',
}

/**
 * Aplica o efeito de um pagamento confirmado:
 * - Pacote → cria lote em creditos_avulsos (validade 3 meses)
 * - Assinatura → ativa o plano correspondente (sem expira_em, é mensal)
 */
async function aplicarEfeitoPagamento(params: {
  fornecedorId: string
  pagamentoId: string
  tipo: TipoCobranca
  asaasSubscriptionId: string | null
}): Promise<void> {
  const { fornecedorId, pagamentoId, tipo } = params

  // Busca dados atuais do fornecedor
  const { data: fornecedor } = await supabase
    .from('leads_fornecedores')
    .select('nome, whatsapp, plano')
    .eq('id', fornecedorId)
    .single()

  if (!fornecedor) {
    console.error(`[asaas-webhook] fornecedor ${fornecedorId} não encontrado`)
    return
  }

  // ============================================================
  // Caso 1: Pacote de leads → cria lote em creditos_avulsos
  // ============================================================
  if (
    tipo === 'pacote_leads_5' ||
    tipo === 'pacote_leads_10' ||
    tipo === 'pacote_leads_25'
  ) {
    const quantidade = QUANTIDADE_LEADS_POR_PACOTE[tipo]

    const resultado = await creditarLoteAvulso({
      fornecedorId,
      quantidade,
      pagamentoId,
    })

    if (!resultado.ok) {
      console.error(
        `[asaas-webhook] creditarLoteAvulso falhou pra pagamento ${pagamentoId}:`,
        resultado.erro
      )
      // Não retorna: notifica o fornecedor mesmo assim (já pagou),
      // mas o lote não foi criado. Sinaliza pra investigação via log.
    }

    // Notifica fornecedor
    try {
      await enviarMensagem(
        fornecedor.whatsapp,
        `🎉 Pagamento confirmado, ${fornecedor.nome}!\n\nVocê acabou de adicionar *${quantidade} pedidos extras* à sua conta. Eles ficam disponíveis até serem usados.\n\nVou começar a te ofertar pedidos compatíveis novamente!`
      )
    } catch (err) {
      console.error('[asaas-webhook] notificação pacote falhou:', err)
    }

    return
  }

  // ============================================================
  // Caso 2: Assinatura → ativa o plano
  // ============================================================
  if (
    tipo === 'assinatura_starter' ||
    tipo === 'assinatura_pro'
  ) {
    const novoPlano = PLANO_POR_ASSINATURA[tipo]
    const config = PLANOS_CONFIG[novoPlano]

    await supabase
      .from('leads_fornecedores')
      .update({
        plano: novoPlano,
        plano_ativado_em: new Date().toISOString(),
        // plano_expira_em = NULL para assinaturas pagas (mensal recorrente, sem fim)
        plano_expira_em: null,
      })
      .eq('id', fornecedorId)

    // Notifica fornecedor
    try {
      await enviarMensagem(
        fornecedor.whatsapp,
        `🎉 Pagamento confirmado, ${fornecedor.nome}!\n\nSeu plano foi atualizado para *${config.nome}* — agora você recebe até *${config.leads_inclusos} pedidos por mês*.\n\nA cobrança é mensal e renova automaticamente. Você pode cancelar a qualquer momento pelo painel.`
      )
    } catch (err) {
      console.error('[asaas-webhook] notificação assinatura falhou:', err)
    }

    return
  }
}
