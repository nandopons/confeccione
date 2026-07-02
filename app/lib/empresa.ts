// app/lib/empresa.ts
// ============================================================================
// Dados cadastrais da Confeccione (MEI) usados em documentos gerados
// (orçamentos em PDF etc.). Centralizado aqui pra ser fácil de trocar.
// ============================================================================

export const EMPRESA = {
  nome: 'Confeccione',
  cnpj: '49.307.439/0001-50',
  site: 'confeccione.com.br',
  email: 'contato@confeccione.com.br',
  selo: 'Empresa embarcada no Porto Digital.',
} as const
