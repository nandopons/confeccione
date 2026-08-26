// app/lib/teclado.ts
// ============================================================================
// Onde o card do chat deve ficar quando o teclado virtual está aberto.
//
// HISTÓRICO CURTO, PORQUE ELE EXPLICA O DESENHO (26/08/2026)
//
// 1ª tentativa — encolher o card e alinhar o topo rolando a página.
// 2ª tentativa — trocar a régua de detecção (`window.innerHeight`).
//
// As duas falharam, e a sonda em /sonda-teclado.html mostrou por quê, num
// Chrome 151 / Android, tela 384×832:
//
//     t=134   vv.height cai 692 → 425     (teclado ocupa 267px)
//     t=184…301  vv.offsetTop sobe 0 → 267
//                card.top praticamente parado (155 → 117)
//
// O Chrome NÃO rola o documento pra revelar o campo: ele DESLOCA O VIEWPORT
// VISUAL por cima da página. Duas consequências fatais pra abordagem antiga:
//
//   · `window.scrollBy` mexe no documento, e a página /alinhar é mais curta
//     que o viewport de layout (692px) — não há para onde rolar. O
//     alinhamento era um no-op.
//   · `visualViewport.offsetTop` não é gravável. Não dá pra desfazer o
//     deslocamento que o navegador aplicou.
//
// Resultado: o topo do card ficava 150px acima da área visível (cabeçalho
// "Sua produção" cortado) e o que aparecia no lugar era o bloco "Precisa de
// ajuda?", que mora ABAIXO do chat na página.
//
// O DESENHO DE AGORA: em vez de encolher o card e torcer pra ele caber, o
// card VIRA A ÁREA VISÍVEL. Com o teclado aberto ele sai do fluxo
// (position: fixed) e é fixado exatamente sobre o viewport visual — topo em
// `offsetTop`, altura igual a `height`. Cabeçalho no topo, caixa de texto
// logo acima do teclado, nada de página aparecendo por baixo.
//
// `top: offsetTop` não é enfeite: elemento `fixed` se posiciona em relação ao
// viewport de LAYOUT, então sem essa compensação ele ficaria 267px acima da
// área visível — exatamente o defeito que estamos consertando.
// ============================================================================

/** Quanto o viewport precisa encolher pra contar como teclado aberto. */
const LIMIAR_TECLADO = 120

/** Abaixo disto não mexemos em nada — vira desktop. */
const LARGURA_DESKTOP = 1024

/** Área visível pequena demais pra valer a pena fixar (teclado + tela minúscula). */
const ALTURA_MINIMA_UTIL = 180

export type Moldura = {
  /** `top` do elemento fixo, em pixels — compensa o deslocamento do viewport. */
  top: number
  /** Altura do card: exatamente a área visível. */
  altura: number
}

export type MedidaViewport = {
  /** window.innerWidth */
  larguraJanela: number
  /** visualViewport.height */
  alturaVisual: number
  /** visualViewport.offsetTop */
  deslocamentoVisual: number
  /** Maior alturaVisual já vista nesta orientação — a régua do "sem teclado". */
  baseVisual: number
}

/**
 * A régua de "sem teclado". Só cresce: enquanto o teclado está aberto o
 * viewport é menor, então ele nunca contamina a base. Quem zera é a troca de
 * orientação.
 *
 * Comparar contra isto, e não contra `window.innerHeight`, mantém a detecção
 * correta tanto onde o teclado encolhe só o viewport visual (Chrome/Android
 * medido, iOS) quanto onde ele encolhe o layout junto.
 */
export function atualizarBase(baseAtual: number, alturaVisual: number): number {
  return alturaVisual > baseAtual ? alturaVisual : baseAtual
}

export function tecladoAberto(alturaVisual: number, baseVisual: number): boolean {
  return alturaVisual < baseVisual - LIMIAR_TECLADO
}

/**
 * A moldura do card com o teclado aberto, ou `null` para "deixa o CSS mandar".
 */
export function moldura(m: MedidaViewport): Moldura | null {
  if (m.larguraJanela >= LARGURA_DESKTOP) return null
  if (!tecladoAberto(m.alturaVisual, m.baseVisual)) return null
  if (m.alturaVisual < ALTURA_MINIMA_UTIL) return null
  return {
    top: Math.max(0, Math.round(m.deslocamentoVisual)),
    altura: Math.round(m.alturaVisual),
  }
}

/** Duas molduras são iguais o bastante pra não valer um novo render? */
export function mesmaMoldura(a: Moldura | null, b: Moldura | null): boolean {
  if (a === null || b === null) return a === b
  return a.top === b.top && a.altura === b.altura
}
