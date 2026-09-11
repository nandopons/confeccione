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
): boolean {
  if (!fornecedorId) return false
  return aprovacaoStatus !== APROVACAO_QUE_DESCLASSIFICA
}
