// app/lib/portfolio-corte.ts
// ============================================================================
// A janela de corte da foto de portfólio — tipo, limites e validação.
//
// Vive separado de portfolio-normalizar.ts por um motivo prático: o editor do
// painel é client component e precisa do tipo e do teto de zoom, e importar o
// normalizador no navegador arrastaria o `sharp` (nativo, servidor) pro bundle.
// Aqui não há dependência nenhuma — roda nos dois lados.
// ============================================================================

import type { Enquadramento } from './portfolio-enquadramento'

/** Janela de corte sobre a foto crua. */
export type Corte = {
  /** 0 = encostado à esquerda, 50 = centro, 100 = à direita. */
  x: number
  /** 0 = topo, 50 = meio, 100 = base. */
  y: number
  /** 1 = maior corte 4:5 que cabe na foto. Acima disso, aproxima. */
  zoom: number
}

export const CORTE_PADRAO: Corte = { x: 50, y: 0, zoom: 1 }
export const ZOOM_MAX = 3

const entre = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v))

export function corteValido(bruto: unknown): Corte {
  const b = (bruto ?? {}) as Record<string, unknown>
  const num = (v: unknown, padrao: number) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : padrao
  }
  return {
    x: Math.round(entre(num(b.x, CORTE_PADRAO.x), 0, 100)),
    y: Math.round(entre(num(b.y, CORTE_PADRAO.y), 0, 100)),
    // 2 casas: o passo do zoom é 0.1 e a coluna é numeric(4,2).
    zoom: Math.round(entre(num(b.zoom, CORTE_PADRAO.zoom), 1, ZOOM_MAX) * 100) / 100,
  }
}

/** Corte equivalente a uma das três âncoras antigas — usado só na migração de
 *  fotos que nunca foram reenquadradas no modelo novo. */
export function corteDoEnquadramento(e: Enquadramento): Corte {
  return { x: 50, y: e === 'topo' ? 0 : e === 'centro' ? 50 : 100, zoom: 1 }
}
