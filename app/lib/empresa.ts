// app/lib/empresa.ts
// ============================================================================
// Dados cadastrais da Confeccione (MEI) usados em documentos gerados
// (orçamentos em PDF etc.). Centralizado aqui pra ser fácil de trocar.
// ============================================================================

export const EMPRESA = {
  nome: 'Confeccione',
  /** Razão social do MEI — ajuste aqui se a oficial for diferente. */
  razaoSocial: 'Fernando Pons',
  cnpj: '49.307.439/0001-50',
  site: 'confeccione.com.br',
  email: 'msg.pons@gmail.com',
  selo: 'Empresa embarcada no Porto Digital.',
} as const
