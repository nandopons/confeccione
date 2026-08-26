// app/lib/teclado.ts
// ============================================================================
// A DECISÃO de que altura o card do chat deve ter quando o teclado virtual
// abre — separada da tela de propósito, porque é aqui que estava o bug e
// lógica de layout dentro de um useEffect não dá pra testar.
//
// POR QUE ISTO EXISTE (26/08/2026)
// A primeira versão detectava o teclado assim:
//
//     tecladoAberto = vv.height < window.innerHeight - 120
//
// Isso só vale onde o teclado encolhe SÓ o viewport visual e deixa o layout
// do mesmo tamanho — o comportamento do iOS Safari. Onde o navegador encolhe
// TAMBÉM o viewport de layout (Chrome no Android, dependendo da versão e do
// `interactive-widget`), `window.innerHeight` diminui junto e a conta vira
// `x < x - 120`: SEMPRE falsa. O teclado abre e o código jura que está
// fechado, o card fica com a altura cheia, o campo some atrás do teclado e o
// navegador rola a página atrás dele. É a "doidera" relatada no Android.
//
// O conserto: comparar contra a MAIOR altura de viewport visual já observada
// (a régua de "sem teclado"), que não depende de o layout encolher ou não.
// ============================================================================

/** Quanto o viewport precisa encolher pra contar como teclado aberto. */
const LIMIAR_TECLADO = 120

/** Piso e teto da altura do card. */
export const ALTURA_MIN = 240
export const ALTURA_MAX = 620

/** Respiro entre o fim do card e o topo do teclado. */
const FOLGA = 10

/**
 * Diferença mínima pra valer uma nova aplicação de altura.
 *
 * Sem isto, cada pixel que o viewport mexe vira um `setState` e o card
 * reposiciona. Somado à animação do teclado, é o sobe-e-desce.
 */
const DEGRAU_MINIMO = 24

/** Abaixo disto não tentamos encolher o card — vira desktop. */
const LARGURA_DESKTOP = 1024

export type MedidaViewport = {
  /** window.innerWidth */
  larguraJanela: number
  /** visualViewport.height */
  alturaVisual: number
  /** visualViewport.offsetTop */
  deslocamentoVisual: number
  /** Maior alturaVisual já vista nesta orientação — a régua do "sem teclado". */
  baseVisual: number
  /** getBoundingClientRect().top do card, relativo ao viewport de LAYOUT. */
  topoDoCard: number
  /** Altura aplicada agora (null = altura padrão do CSS). */
  alturaAtual: number | null
}

/**
 * A régua de "sem teclado". Só cresce: enquanto o teclado está aberto o
 * viewport é menor, então ele nunca contamina a base. Quem zera é a troca de
 * orientação, que chama `baseInicial` de novo.
 */
export function atualizarBase(baseAtual: number, alturaVisual: number): number {
  return alturaVisual > baseAtual ? alturaVisual : baseAtual
}

export function tecladoAberto(alturaVisual: number, baseVisual: number): boolean {
  return alturaVisual < baseVisual - LIMIAR_TECLADO
}

function limitar(valor: number): number {
  return Math.max(ALTURA_MIN, Math.min(Math.round(valor), ALTURA_MAX))
}

/**
 * A altura que o card deve ter, ou `null` para "deixa o CSS mandar".
 *
 * Devolve `alturaAtual` inalterada quando a mudança seria menor que
 * DEGRAU_MINIMO — é o amortecedor que mata a oscilação.
 */
export function alturaDoCard(m: MedidaViewport): number | null {
  if (m.larguraJanela >= LARGURA_DESKTOP) return null
  if (!tecladoAberto(m.alturaVisual, m.baseVisual)) return null

  // topoDoCard vem do layout; deslocamentoVisual diz onde o viewport visual
  // começa dentro dele. O espaço útil abaixo do topo do card é a diferença.
  const disponivel = m.alturaVisual + m.deslocamentoVisual - m.topoDoCard - FOLGA
  const alvo = limitar(disponivel)

  if (m.alturaAtual !== null && Math.abs(alvo - m.alturaAtual) < DEGRAU_MINIMO) {
    return m.alturaAtual
  }
  return alvo
}
