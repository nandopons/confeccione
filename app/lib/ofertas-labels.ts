// app/lib/ofertas-labels.ts
// ============================================================================
// Constantes puras de label de tipo/prazo de oferta.
// Arquivo SEM SIDE-EFFECTS — pode ser importado por client components sem
// arrastar Supabase, env vars server-only, ou qualquer outro módulo pesado
// pro bundle do browser.
//
// O ofertas.ts re-exporta daqui pra preservar os imports server existentes.
// ============================================================================

export const tipoLabel: Record<string, string> = {
  interclasse: 'Interclasse/Evento',
  private_label: 'Private Label',
  fitness: 'Fitness',
  moda_praia: 'Moda Praia',
  moda_intima: 'Moda Íntima',
  padrao_esportivo: 'Padrão Esportivo',
  fardamento: 'Fardamento',
  inverno: 'Inverno',
  roupas_uv: 'Roupas UV',
  bones: 'Bonés',
  bolsas: 'Bolsas e Acessórios',
}

export const prazoLabel: Record<string, string> = {
  urgente: 'Urgente (até 7 dias)',
  normal: 'Normal (8 a 21 dias)',
  sempressa: 'Sem pressa (21+ dias)',
}
