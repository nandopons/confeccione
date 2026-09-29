// app/lib/asaas-reconciliar.ts
// ============================================================================
// O WEBHOOK DO ASAAS FALHA EM SILÊNCIO; A RECONCILIAÇÃO NÃO — 29/09/2026
//
// A Ester (20260900311, R$ 102,06, Dom Santo) pagou em 17/09, a peça foi
// produzida e entregue, e o sistema ficou 12 dias em "sem resposta": o Asaas
// tinha a cobrança como RECEIVED e nunca mandou o webhook — nem o
// PAYMENT_CREATED dela existe em webhook_debug. O André (268, R$ 406,19) era
// o mesmo caso, CONFIRMED sem ninguém saber. O Fernando: "era pra ter
// sinalizado dentro do sistema".
//
// A rota /api/admin/asaas/reconciliar já perguntava ao Asaas cobrança por
// cobrança — mas só quando alguém clicava. Agora roda sozinha, uma vez por
// hora, pelo scheduler: cobrança pendente aqui e paga lá → marca pago e
// dispara o mesmo que o webhook dispararia (contatos revelados, avisos).
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import { buscarCobranca, mapearStatusAsaas } from './asaas-payments'
import { revelarContatosPedidoPago } from './pedido-assistente-oferta'

export type ResultadoReconciliacao = {
  codigo: string | null
  nome: string | null
  valorCentavos: number | null
  statusAsaas: string
  acao: 'marcado_pago' | 'sem_mudanca' | 'erro'
  detalhe?: string
}

export async function reconciliarPagamentosAsaas(opts: { silencioso?: boolean; limite?: number } = {}): Promise<{ verificados: number; marcadosPago: number; resultados: ResultadoReconciliacao[] }> {
  const silencioso = opts.silencioso ?? false
  const { data: pendentes, error } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, codigo, nome, valor_centavos, pagamento_status, asaas_payment_id')
    .not('asaas_payment_id', 'is', null)
    .is('encerrado_em', null)
    .or('pagamento_status.is.null,pagamento_status.neq.pago')
    .order('orcamento_definido_em', { ascending: false, nullsFirst: false })
    .limit(opts.limite ?? 50)
  if (error) throw new Error(`reconciliar asaas: ${error.message}`)

  const resultados: ResultadoReconciliacao[] = []
  let marcados = 0
  for (const p of pendentes ?? []) {
    try {
      const cobranca = await buscarCobranca(p.asaas_payment_id as string)
      const interno = mapearStatusAsaas(cobranca.status)
      if (interno === 'pago') {
        await supabaseAdmin.from('pedidos_assistente').update({ pagamento_status: 'pago', atualizado_em: new Date().toISOString() }).eq('id', p.id)
        if (!silencioso) await revelarContatosPedidoPago(p.id)
        marcados++
        console.warn('[asaas-reconciliar] pagamento achado sem webhook', { codigo: p.codigo, status: cobranca.status })
        resultados.push({ codigo: p.codigo, nome: p.nome, valorCentavos: p.valor_centavos, statusAsaas: cobranca.status, acao: 'marcado_pago', detalhe: silencioso ? 'sem mensagens (silencioso)' : 'mensagens de confirmação enviadas' })
      } else {
        resultados.push({ codigo: p.codigo, nome: p.nome, valorCentavos: p.valor_centavos, statusAsaas: cobranca.status, acao: 'sem_mudanca' })
      }
    } catch (err) {
      resultados.push({ codigo: p.codigo, nome: p.nome, valorCentavos: p.valor_centavos, statusAsaas: 'desconhecido', acao: 'erro', detalhe: err instanceof Error ? err.message : String(err) })
    }
  }
  return { verificados: (pendentes ?? []).length, marcadosPago: marcados, resultados }
}
