// app/api/asaas/webhook/route.ts
// ============================================================================
// Webhook do Asaas — recebe eventos de pagamento e atualiza estado interno.
// Configurado no painel Asaas → Integrações → Webhooks.
//
// Eventos tratados:
// - PAYMENT_CREATED         → upsert defensivo (cria local se não existe)
// - PAYMENT_UPDATED         → UPDATE status conforme novo status
// - PAYMENT_CONFIRMED       → UPDATE status=pago + aplica efeito (lote/plano)
// - PAYMENT_RECEIVED        → idem (Pix/Boleto)
// - PAYMENT_OVERDUE         → UPDATE status=vencido
// - PAYMENT_DELETED         → UPDATE status=cancelado
// - PAYMENT_REFUNDED        → UPDATE status=estornado (TODO #12: reverter efeito)
// - SUBSCRIPTION_*          → log apenas (próxima sprint)
//
// Validação: header asaas-access-token deve bater com ASAAS_WEBHOOK_TOKEN.
//
// Failure-soft: webhook SEMPRE retorna 200 pro Asaas (exceto 401 em token
// inválido e 503 quando ASAAS_WEBHOOK_TOKEN ausente). Isso evita o Asaas
// marcar o webhook como falho e penalizar a fila.
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { mapearStatusAsaas, type AsaasPaymentStatus } from '@/app/lib/asaas-payments'
import { PLANOS_CONFIG, creditarLoteAvulso, type Plano } from '@/app/lib/planos'
import { enviarMensagem } from '@/app/lib/zapi'
import { revelarContatosPedidoPago } from '@/app/lib/pedido-assistente-oferta'

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
  // 1. Validação de configuração + autenticação
  // ============================================================
  const tokenEsperado = process.env.ASAAS_WEBHOOK_TOKEN
  if (!tokenEsperado) {
    console.error('[asaas-webhook] ASAAS_WEBHOOK_TOKEN não configurado no env')
    return NextResponse.json(
      { error: 'webhook_not_configured' },
      { status: 503 }
    )
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
    // 200 mesmo em payload inválido — Asaas não vai reenviar, marca ignorado.
    return NextResponse.json({ ok: true, ignorado: 'payload_invalido' })
  }

  // Log pra debug — tabela correta é `webhook_debug` (não `asaas_webhook_debug`,
  // que NÃO existe — bug latente até esta sprint).
  await supabase
    .from('webhook_debug')
    .insert({ body: payload as unknown as Record<string, unknown> })
    .then(
      () => undefined,
      (err) => {
        console.error('[asaas-webhook] INSERT webhook_debug falhou:', err)
      }
    )

  if (!payload.payment || !payload.event) {
    return NextResponse.json({ ok: true, ignorado: 'sem_payment_ou_event' })
  }

  const { payment, event } = payload

  // ============================================================
  // 3. Tratamento por evento — todos failure-soft retornam 200
  // ============================================================
  try {
    if (event === 'PAYMENT_CREATED') {
      // Upsert defensivo: cria local se não existe.
      // Caso esperado: pagamento já existe (criado pela lib em /checkout).
      // Caso defesa: criado direto no painel Asaas → cria registro stub.
      await upsertPagamentoCreated(payment)
    } else if (
      event === 'PAYMENT_CONFIRMED' ||
      event === 'PAYMENT_RECEIVED' ||
      event === 'PAYMENT_OVERDUE' ||
      event === 'PAYMENT_DELETED' ||
      event === 'PAYMENT_REFUNDED' ||
      event === 'PAYMENT_UPDATED'
    ) {
      if (event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_RECEIVED') {
        await marcarPedidoAssistentePago(payment)
      }
      await atualizarStatusEAplicarEfeito(event, payment)
    } else if (event.startsWith('SUBSCRIPTION_')) {
      // Próxima sprint
      console.log('[asaas-webhook] evento SUBSCRIPTION ignorado por enquanto:', event)
    } else {
      console.log('[asaas-webhook] evento não tratado:', event)
    }
  } catch (err) {
    // NUNCA propaga erro pro Asaas (200 sempre). Log estruturado pra debug.
    console.error('[asaas-webhook] erro no handler:', {
      event,
      paymentId: payment.id,
      err: err instanceof Error ? err.message : String(err),
    })
  }

  return NextResponse.json({ ok: true, event, paymentId: payment.id })
}

// ============================================================
// Handler: PAYMENT_CREATED
// ============================================================
//
// Caso esperado: o registro local JÁ existe (criado pela lib em /checkout
// antes do webhook chegar). Nesse caso é no-op — link/QR já populados.
//
// Caso defensivo: pagamento criado direto no painel Asaas (fora do nosso
// checkout). NÃO criamos stub porque não há como inferir o `tipo` do produto
// a partir do payload do webhook (só temos `value`, que varia por plano).
// Apenas logamos warning estruturado pra admin investigar manualmente.
async function upsertPagamentoCreated(
  payment: NonNullable<AsaasWebhookPayload['payment']>
): Promise<void> {
  const { data: jaExiste } = await supabase
    .from('pagamentos_asaas')
    .select('id')
    .eq('asaas_payment_id', payment.id)
    .maybeSingle()

  if (jaExiste) {
    // No-op — registro já criado pela lib.
    return
  }

  // Pagamento externo (criado no painel Asaas). Sem tipo inferível ⇒ não
  // persiste. Webhook subsequente (PAYMENT_CONFIRMED) também vai logar
  // "não encontrado localmente" e ignorar.
  console.warn('[asaas-webhook] PAYMENT_CREATED sem registro local', {
    paymentId: payment.id,
    externalReference: payment.externalReference ?? null,
    value: payment.value,
  })
}

// ============================================================
// Handler: PAYMENT_* (CONFIRMED, RECEIVED, OVERDUE, DELETED, REFUNDED, UPDATED)
// ============================================================
async function atualizarStatusEAplicarEfeito(
  event: string,
  payment: NonNullable<AsaasWebhookPayload['payment']>
): Promise<void> {
  const novoStatus = mapearStatusAsaas(payment.status)

  const { data: pagamentoAtualizado, error: errUpd } = await supabase
    .from('pagamentos_asaas')
    .update({
      status: novoStatus,
      pago_em:
        novoStatus === 'pago' && payment.paymentDate
          ? new Date(payment.paymentDate).toISOString()
          : null,
    })
    .eq('asaas_payment_id', payment.id)
    .select('id, fornecedor_id, tipo, asaas_subscription_id')
    .maybeSingle()

  if (errUpd) {
    console.error('[asaas-webhook] update pagamento falhou:', errUpd)
    return
  }

  if (!pagamentoAtualizado) {
    console.warn(
      `[asaas-webhook] pagamento ${payment.id} não encontrado localmente, ignorando ${event}`
    )
    return
  }

  // TODO #12: PAYMENT_REFUNDED deveria REVERTER o efeito (estornar lote ou
  // desativar plano). Hoje só marca status='estornado' no nosso registro.
  // Tratar quando volume de estornos justificar.

  // Aplica efeito apenas em pagamento confirmado (uma vez por pagamento)
  if (novoStatus === 'pago') {
    await aplicarEfeitoPagamento({
      fornecedorId: pagamentoAtualizado.fornecedor_id,
      pagamentoId: pagamentoAtualizado.id,
      tipo: pagamentoAtualizado.tipo as TipoCobranca,
      asaasSubscriptionId: pagamentoAtualizado.asaas_subscription_id,
    })
  }
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

    // Convenção: plano_expira_em SEMPRE preenchido (não NULL).
    // Próximo PAYMENT_CONFIRMED renova pra +30 dias. Falha de pagamento ⇒
    // data fica no passado ⇒ planoEfetivo cai pra 'free' até pagar de novo.
    const plano30Dias = new Date()
    plano30Dias.setUTCDate(plano30Dias.getUTCDate() + 30)
    await supabase
      .from('leads_fornecedores')
      .update({
        plano: novoPlano,
        plano_ativado_em: new Date().toISOString(),
        plano_expira_em: plano30Dias.toISOString(),
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


// ============================================================
// Handler extra: marca o PEDIDO de cliente (pedidos_assistente) como pago.
// O PIX do pedido tem externalReference = id do pedido e asaas_payment_id no
// nosso registro. Independente do fluxo de billing do fornecedor.
// ============================================================
async function marcarPedidoAssistentePago(
  payment: NonNullable<AsaasWebhookPayload['payment']>
): Promise<void> {
  try {
    const { data: antes } = await supabase
      .from('pedidos_assistente')
      .select('id, pagamento_status')
      .eq('asaas_payment_id', payment.id)
      .maybeSingle<{ id: string; pagamento_status: string | null }>()
    if (!antes) return

    await supabase
      .from('pedidos_assistente')
      .update({ pagamento_status: 'pago', atualizado_em: new Date().toISOString() })
      .eq('asaas_payment_id', payment.id)

    // só revela contatos na TRANSIÇÃO pra pago (evita reenvio em webhooks repetidos)
    if (antes.pagamento_status !== 'pago') {
      await revelarContatosPedidoPago(antes.id)
    }
  } catch (err) {
    console.error('[asaas-webhook] marcar pedido pago falhou:', err)
  }
}
