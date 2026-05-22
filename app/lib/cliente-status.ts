// app/lib/cliente-status.ts
// ============================================================================
// Mapeamento de status técnico do pedido → label amigável + cor pro cliente
// final. Fallback é o status cru caso apareça valor novo no schema.
// ============================================================================

export const STATUS_PEDIDO_LABEL: Record<string, string> = {
  buscando_fornecedor: 'Procurando fornecedor',
  em_negociacao: 'Negociando com fornecedor',
  concluido: 'Concluído',
  expirado_sem_resposta: 'Sem fornecedor disponível',
  manual_pausado: 'Pausado',
}

export const STATUS_PEDIDO_COR: Record<string, string> = {
  buscando_fornecedor: 'bg-blue-100 text-blue-700',
  em_negociacao: 'bg-sky-100 text-sky-700',
  concluido: 'bg-green-100 text-green-700',
  expirado_sem_resposta: 'bg-red-100 text-red-700',
  manual_pausado: 'bg-gray-100 text-gray-600',
}

export function labelStatus(status: string): string {
  return STATUS_PEDIDO_LABEL[status] ?? status
}

export function corStatus(status: string): string {
  return STATUS_PEDIDO_COR[status] ?? 'bg-gray-100 text-gray-700'
}
