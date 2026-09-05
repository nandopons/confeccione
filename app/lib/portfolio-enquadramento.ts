// app/lib/portfolio-enquadramento.ts
// ============================================================================
// As três âncoras antigas do corte 4:5 (topo/centro/base).
//
// Continuam existindo porque a coluna `enquadramento` continua existindo: ela
// guarda o resumo legível do corte e é de onde sai o corte das fotos que nunca
// passaram pelo ajuste livre. Fica em arquivo próprio, sem dependências, pra
// poder ser importada do navegador — ver portfolio-corte.ts.
// ============================================================================

/** De onde o corte 4:5 parte. Modelo antigo, hoje derivado de `foco_y`. */
export type Enquadramento = 'topo' | 'centro' | 'base'

export const ENQUADRAMENTOS: Enquadramento[] = ['topo', 'centro', 'base']

export function enquadramentoValido(v: unknown): Enquadramento {
  return ENQUADRAMENTOS.includes(v as Enquadramento) ? (v as Enquadramento) : 'topo'
}
