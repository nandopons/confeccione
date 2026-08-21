// app/lib/orcamento-parcelas.ts
// ============================================================================
// Parcelas do orçamento avulso: integral, ou sinal de 50% + final.
//
// REGRA CENTRAL — QUANDO O PEDIDO ENTRA EM PRODUÇÃO
// `orcamentos.pagamento_status = 'pago'` significa "já dá pra produzir".
//   integral  -> quando a única cobrança é paga
//   sinal_50  -> quando o SINAL é pago (decisão do Fernando, 21/08/2026: o
//                sinal cobre o material, então a produção começa ali)
// O quadro de produção lê essa coluna e não precisa saber de parcela nenhuma.
//
// DESCONTO
// Só existe no integral. Sinal e parcela final saem cheios — o desconto é o
// prêmio de quem paga tudo de uma vez, não um abatimento genérico.
//
// BAIXA MANUAL
// Cliente que faz PIX direto na chave existe, e negar isso só faria você
// anotar em outro lugar. Mas exige motivo e fica marcada como 'manual', pra
// nunca ser confundida com confirmação do gateway.
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import { criarCobrancaOrcamento } from './orcamento-cobranca'

export type RotuloParcela = 'integral' | 'sinal' | 'final'
export type StatusParcela = 'gerada' | 'paga' | 'cancelada'

export type Parcela = {
  id: string
  parcela: number
  rotulo: RotuloParcela
  valorCentavos: number
  descontoPercentual: number
  vencimento: string | null
  asaasPaymentId: string | null
  asaasInvoiceUrl: string | null
  pixCopiaCola: string | null
  status: StatusParcela
  pagoEm: string | null
  origemBaixa: 'asaas' | 'manual' | null
  baixaMotivo: string | null
}

type LinhaCobranca = {
  id: string
  parcela: number
  rotulo: RotuloParcela
  valor_centavos: number
  desconto_percentual: number
  vencimento: string | null
  asaas_payment_id: string | null
  asaas_invoice_url: string | null
  pix_copia_cola: string | null
  status: StatusParcela
  pago_em: string | null
  origem_baixa: 'asaas' | 'manual' | null
  baixa_motivo: string | null
}

function mapear(l: LinhaCobranca): Parcela {
  return {
    id: l.id,
    parcela: l.parcela,
    rotulo: l.rotulo,
    valorCentavos: l.valor_centavos,
    descontoPercentual: l.desconto_percentual,
    vencimento: l.vencimento,
    asaasPaymentId: l.asaas_payment_id,
    asaasInvoiceUrl: l.asaas_invoice_url,
    pixCopiaCola: l.pix_copia_cola,
    status: l.status,
    pagoEm: l.pago_em,
    origemBaixa: l.origem_baixa,
    baixaMotivo: l.baixa_motivo,
  }
}

export async function listarParcelas(orcamentoId: string): Promise<Parcela[]> {
  const { data } = await supabaseAdmin
    .from('orcamento_cobrancas')
    .select(
      'id, parcela, rotulo, valor_centavos, desconto_percentual, vencimento, ' +
        'asaas_payment_id, asaas_invoice_url, pix_copia_cola, status, pago_em, origem_baixa, baixa_motivo',
    )
    .eq('orcamento_id', orcamentoId)
    .order('parcela', { ascending: true })

  return ((data ?? []) as unknown as LinhaCobranca[]).map(mapear)
}

/**
 * Divide o total em duas metades sem perder centavo.
 * O sinal fica com o centavo ímpar — melhor sobrar no primeiro, que é o que
 * você recebe antes de gastar com material.
 */
export function metades(totalCentavos: number): { sinal: number; final: number } {
  const sinal = Math.ceil(totalCentavos / 2)
  return { sinal, final: totalCentavos - sinal }
}

/**
 * Recalcula `orcamentos.pagamento_status` a partir das parcelas.
 *
 * Ponto único de verdade: webhook, reconciliação e baixa manual todos passam
 * por aqui, então não existe caminho que marque pago de um jeito diferente.
 */
export async function recomputarPagamento(orcamentoId: string): Promise<void> {
  const { data: orc } = await supabaseAdmin
    .from('orcamentos')
    .select('modalidade, pagamento_status')
    .eq('id', orcamentoId)
    .maybeSingle<{ modalidade: string; pagamento_status: string | null }>()
  if (!orc) return

  const parcelas = await listarParcelas(orcamentoId)
  if (!parcelas.length) return

  const paga = (rot: RotuloParcela) =>
    parcelas.some((p) => p.rotulo === rot && p.status === 'paga')

  const liberado = orc.modalidade === 'sinal_50' ? paga('sinal') : paga('integral')

  const novo = liberado ? 'pago' : 'gerado'
  if (orc.pagamento_status === novo) return

  await supabaseAdmin
    .from('orcamentos')
    .update({
      pagamento_status: novo,
      // pago_em marca a liberação da produção, não a quitação total.
      pago_em: liberado ? new Date().toISOString() : null,
    })
    .eq('id', orcamentoId)
}

/** Marca uma parcela como paga pelo id da cobrança no Asaas. Usado pelo webhook. */
export async function marcarParcelaPagaPorAsaas(paymentId: string): Promise<boolean> {
  const { data: cob } = await supabaseAdmin
    .from('orcamento_cobrancas')
    .select('id, orcamento_id, status')
    .eq('asaas_payment_id', paymentId)
    .maybeSingle<{ id: string; orcamento_id: string; status: StatusParcela }>()

  if (!cob || cob.status === 'paga') return false

  await supabaseAdmin
    .from('orcamento_cobrancas')
    .update({
      status: 'paga',
      pago_em: new Date().toISOString(),
      origem_baixa: 'asaas',
      atualizado_em: new Date().toISOString(),
    })
    .eq('id', cob.id)

  await recomputarPagamento(cob.orcamento_id)
  return true
}

export type ResultadoParcela = { ok: true; parcela?: Parcela } | { ok: false; erro: string }

/**
 * Cria a cobrança da parcela FINAL de um orçamento 50/50.
 *
 * Só depois do sinal pago: enviar as duas de uma vez tira o sentido do sinal,
 * e o cliente pagaria a que preferisse.
 */
export async function gerarParcelaFinal(orcamentoId: string): Promise<ResultadoParcela> {
  const { data: orc } = await supabaseAdmin
    .from('orcamentos')
    .select('id, numero, modalidade, total_centavos, cliente_nome, cliente_documento, cliente_email')
    .eq('id', orcamentoId)
    .maybeSingle<{
      id: string
      numero: string
      modalidade: string
      total_centavos: number | null
      cliente_nome: string | null
      cliente_documento: string | null
      cliente_email: string | null
    }>()

  if (!orc) return { ok: false, erro: 'Orçamento não encontrado' }
  if (orc.modalidade !== 'sinal_50') return { ok: false, erro: 'Este orçamento não é 50/50' }
  if (!orc.cliente_nome || !orc.cliente_documento) {
    return { ok: false, erro: 'Cobrança exige nome e CPF/CNPJ do cliente' }
  }

  const parcelas = await listarParcelas(orcamentoId)
  const sinal = parcelas.find((p) => p.rotulo === 'sinal')
  if (!sinal) return { ok: false, erro: 'Sinal ainda não foi gerado' }
  if (sinal.status !== 'paga') return { ok: false, erro: 'O sinal ainda não foi pago' }
  if (parcelas.some((p) => p.rotulo === 'final')) {
    return { ok: false, erro: 'A parcela final já foi gerada' }
  }

  const { final } = metades(orc.total_centavos ?? 0)
  if (final <= 0) return { ok: false, erro: 'Valor da parcela final inválido' }

  try {
    const cobranca = await criarCobrancaOrcamento({
      orcamentoId: orc.id,
      numero: orc.numero,
      nome: orc.cliente_nome,
      cpfCnpj: orc.cliente_documento,
      email: orc.cliente_email,
      valorCentavos: final,
      descontoPercentual: 0, // parcela do 50/50 nunca tem desconto
      sufixoDescricao: 'parcela final 50%',
    })

    const { data: nova } = await supabaseAdmin
      .from('orcamento_cobrancas')
      .insert({
        orcamento_id: orc.id,
        parcela: 2,
        rotulo: 'final',
        valor_centavos: final,
        desconto_percentual: 0,
        vencimento: cobranca.vencimento ?? null,
        asaas_payment_id: cobranca.paymentId,
        asaas_invoice_url: cobranca.invoiceUrl,
        pix_copia_cola: cobranca.copiaCola,
        pix_qr_imagem: cobranca.qrImagem,
        status: 'gerada',
      })
      .select(
        'id, parcela, rotulo, valor_centavos, desconto_percentual, vencimento, ' +
          'asaas_payment_id, asaas_invoice_url, pix_copia_cola, status, pago_em, origem_baixa, baixa_motivo',
      )
      .maybeSingle<LinhaCobranca>()

    return { ok: true, parcela: nova ? mapear(nova) : undefined }
  } catch (e) {
    console.error('[orcamento-parcelas] falha ao gerar parcela final', e)
    return { ok: false, erro: 'O Asaas recusou a criação da cobrança' }
  }
}

/**
 * Baixa manual — o cliente pagou por fora (PIX direto na chave, dinheiro).
 *
 * Motivo é obrigatório. Daqui a três meses, "por que esta cobrança está paga
 * se o Asaas nunca viu o dinheiro" é uma pergunta que alguém vai fazer.
 */
export async function baixaManual(params: {
  orcamentoId: string
  parcela: number
  motivo: string
}): Promise<ResultadoParcela> {
  const motivo = params.motivo.trim()
  if (motivo.length < 3) return { ok: false, erro: 'Descreva o motivo da baixa manual' }

  const { data: cob } = await supabaseAdmin
    .from('orcamento_cobrancas')
    .select('id, status')
    .eq('orcamento_id', params.orcamentoId)
    .eq('parcela', params.parcela)
    .maybeSingle<{ id: string; status: StatusParcela }>()

  if (!cob) return { ok: false, erro: 'Parcela não encontrada' }
  if (cob.status === 'paga') return { ok: false, erro: 'Esta parcela já está paga' }

  const agora = new Date().toISOString()
  await supabaseAdmin
    .from('orcamento_cobrancas')
    .update({
      status: 'paga',
      pago_em: agora,
      origem_baixa: 'manual',
      baixa_motivo: motivo,
      atualizado_em: agora,
    })
    .eq('id', cob.id)

  await recomputarPagamento(params.orcamentoId)
  return { ok: true }
}
