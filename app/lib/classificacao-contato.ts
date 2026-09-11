// app/lib/classificacao-contato.ts
// ============================================================================
// QUEM É FORNECEDOR — a regra, em um lugar só (11/09/2026).
//
// Existia em dois lugares com definições diferentes, e um deles mentia:
//
//   • o Luigi (luigi.ts) decidia por `Boolean(contato.fornecedor_id)`
//   • o selo do inbox (WhatsAppInbox.tsx) decidia por `contato.fornecedor_id`
//
// Quando o Luigi ganhou a checagem de `aprovacao_status`, o selo continuou no
// critério antigo — a tela dizia FORNECEDOR enquanto o agente já atendia a
// pessoa como cliente. Duas telas contando histórias diferentes sobre a mesma
// conversa é pior que as duas erradas do mesmo jeito: some a chance de alguém
// perceber o erro.
//
// Por isso a regra é uma função pura, importada pelos dois. Quem muda o
// critério muda aqui, e os dois lados acompanham.
// ============================================================================

import { supabaseAdmin } from './supabase-server'

/** O único status de aprovação que derruba a classificação de fornecedor. */
export const APROVACAO_QUE_DESCLASSIFICA = 'reprovado'

/**
 * É fornecedor?
 *
 * `pausado` e os demais continuam sendo fornecedor: pausado é confecção que
 * pediu pra não receber oferta agora, não gente que nunca foi confecção.
 * `reprovado` é a triagem tendo dito "isto aqui não é uma confecção" — e é
 * exatamente quem não pode ser tratado como uma.
 */
export function ehFornecedorClassificado(
  fornecedorId: string | null | undefined,
  aprovacaoStatus: string | null | undefined,
  reclassificadoEm?: string | null,
): boolean {
  if (!fornecedorId) return false
  // Reclassificado explicitamente por gente (ou pelo Luigi com evidência):
  // vale mais que qualquer status de triagem, porque é a decisão mais recente
  // e foi tomada com a pessoa dizendo o que ela é. O lead continua existindo.
  if (reclassificadoEm) return false
  return aprovacaoStatus !== APROVACAO_QUE_DESCLASSIFICA
}

// ─── A correção ─────────────────────────────────────────────────────────────


export type ResultadoReclassificacao = { ok: true } | { ok: false; erro: string }

/**
 * Por que este fornecedor NÃO pode deixar de ser fornecedor agora.
 *
 * Devolve a frase do impedimento, ou null quando está liberado.
 *
 * PRODUÇÃO SE ALCANÇA PELO PEDIDO, NÃO PELO FORNECEDOR: `producao_pedido` não
 * tem `fornecedor_id` (as colunas são pedido_id e orcamento_id). A primeira
 * versão desta trava consultava por fornecedor — daria 400 e, pela regra de
 * "consulta de trava que falha não libera", bloquearia TODA reclassificação
 * pra sempre, em silêncio. Como a checagem de oferta aceita já barra antes,
 * chegar ao fim significa zero pedidos, e sem pedido não há produção.
 */
export async function impedimentoParaDeixarDeSerFornecedor(fornecedorId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('pedido_id')
    .eq('fornecedor_id', fornecedorId)
    .eq('status', 'aceita')
  // Consulta de trava que falha não libera: sem saber, não reclassifica.
  if (error) return 'não consegui conferir as ofertas aceitas dela'
  const n = ((data ?? []) as Array<{ pedido_id: string | null }>).filter((o) => o.pedido_id).length
  if (n > 0) return `ela tem ${n} oferta(s) aceita(s) em aberto`
  return null
}

/**
 * Tira (ou devolve) o cadastro de fornecedor, SEM apagar o lead.
 *
 * Usada pelo Luigi e pelo botão do inbox — a mesma função, porque foi a regra
 * morando em dois lugares que fez o selo do inbox mentir enquanto o agente
 * acertava.
 */
export async function reclassificarFornecedor(opts: {
  fornecedorId: string
  para: 'cliente' | 'fornecedor'
  motivo: string
  por: 'luigi' | 'admin'
}): Promise<ResultadoReclassificacao> {
  if (opts.para === 'cliente') {
    const impedimento = await impedimentoParaDeixarDeSerFornecedor(opts.fornecedorId)
    if (impedimento) return { ok: false, erro: impedimento }
  }
  const virarCliente = opts.para === 'cliente'
  const { error } = await supabaseAdmin
    .from('leads_fornecedores')
    .update({
      reclassificado_em: virarCliente ? new Date().toISOString() : null,
      reclassificado_motivo: virarCliente ? opts.motivo.slice(0, 300) : null,
      reclassificado_por: virarCliente ? opts.por : null,
    })
    .eq('id', opts.fornecedorId)
  if (error) return { ok: false, erro: `não consegui gravar a correção: ${error.message}` }
  return { ok: true }
}
