// app/lib/quantidade-dita.ts
// ============================================================================
// A QUANTIDADE QUE O CLIENTE JÁ DISSE — 30/09/2026.
//
// A Patriciane abriu a conversa com "creio que você não atenda minha
// necessidade, quero menos de 10 peças, micro impressa". Duas mensagens
// depois o Luigi escreveu "o mínimo por modelo e cor costuma ser 10 peças.
// Quantas você precisaria no total?", como se ela não tivesse dito nada.
// A mensagem estava no histórico; o modelo não ligou uma coisa à outra.
//
// Este módulo é a parte de código: varre as mensagens DELE na conversa e
// devolve a última quantidade que ele declarou, com a hora, pro contexto do
// prompt dizer em letras grandes "ele já disse X". Puro, sem banco — quem
// carrega as mensagens é o luigi.ts. Não substitui o histórico; é a régua
// que o modelo não pode deixar de ver.
// ============================================================================

export type QuantidadeDita = {
  /** O trecho da mensagem dele, como ele escreveu (uma frase, até ~110 chars). */
  trecho: string
  /** Quando ele disse (ISO da mensagem). */
  criado_em: string
  /** O número, quando havia um ("menos de 10" → 10, "8 camisetas" → 8). */
  numero: number | null
  /**
   * Abaixo do mínimo de 10 por modelo e cor (regra do Fernando, 29/09):
   * número < 10, "menos de / no máximo / até N" com N ≤ 10, ou fala
   * qualitativa ("poucas peças", "lote pequeno").
   */
  abaixoDoMinimo: boolean
}

export const MINIMO_POR_MODELO_E_COR = 10

const NUMERO_POR_EXTENSO: Record<string, number> = {
  uma: 1, um: 1, duas: 2, dois: 2, tres: 3, três: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, quinze: 15, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, cem: 100,
}

// Unidades que fazem um número virar quantidade de produção. "uns 10 dias",
// "R$ 10", "tamanho 10" ficam de fora porque não têm unidade daqui.
const UNIDADE =
  '(?:pe[çc]as?|unidades?|unid\\.?|un\\b|camis(?:et)?as?|blusas?|uniformes?|fardas?|fardamentos?|conjuntos?|vestidos?|cal[çc]as?|bermudas?|shorts?|jalecos?|polos?|moletons?|bon[ée]s?|kits?|regatas?|leggings?|tops?|saias?|blazers?|casacos?|jaquetas?|macac(?:[ãa]o|[õo]es)|bod[iy]s?|bodies|pijamas?|cuecas?|calcinhas?|sungas?|biqu[íi]nis?|aventais?|coletes?|toalhas?|meias?|bolsas?|ecobags?|sacolas?|gorros?|toucas?|batas?|scrubs?|aventais?|abadás?|lenços?|croppeds?|croppados?)'

const NUM = `(\\d{1,4}|${Object.keys(NUMERO_POR_EXTENSO).join('|')})`
const TETO = '(menos de|menos que|no m[áa]ximo|at[ée]|s[óo]|apenas|somente)'
const CERCA = '(?:uns|umas|cerca de|em torno de|mais ou menos|por volta de|aproximadamente|quase)'

// "menos de 10 peças", "só 8 camisetas", "uns 30 uniformes", "20 peças"
const COM_NUMERO = new RegExp(`(?:\\b${TETO}\\s+)?(?:${CERCA}\\s+)?\\b${NUM}\\s*${UNIDADE}`, 'i')
// "poucas peças", "pouca quantidade", "lote pequeno", "não é muita coisa"
const QUALITATIVA = /\b(poucas?\s+(?:pe[çc]as|unidades|camisetas?|uniformes?)|pouca\s+quantidade|quantidade\s+(?:bem\s+|muito\s+)?pequena|pequena\s+quantidade|lote\s+pequeno|pequeno\s+lote|n[ãa]o\s+[ée]\s+muita\s+coisa|pouca\s+coisa)\b/i

function numeroDe(txt: string): number | null {
  const t = txt.toLowerCase()
  if (/^\d+$/.test(t)) return Number(t)
  return NUMERO_POR_EXTENSO[t] ?? null
}

const TRECHO_MAX = 110

/**
 * A frase da mensagem que contém o trecho. Frase longa é aparada AO REDOR do
 * que interessa (o número fica no meio), não pelo começo: "Tenho uma pequena
 * loja no interior e estou começando agora com…" perdia as "12 camisetas".
 */
function fraseComOTrecho(corpo: string, indice: number, tamanho: number): string {
  const partes = corpo.split(/(?<=[.!?\n])\s*/)
  let pos = 0
  let frase = corpo
  let dentro = indice
  for (const p of partes) {
    if (indice >= pos && indice < pos + p.length) {
      frase = p
      dentro = indice - pos
      break
    }
    pos += p.length
  }
  if (frase.length <= TRECHO_MAX) return frase.replace(/\s+/g, ' ').trim()
  const antes = Math.max(0, Math.min(dentro - 50, frase.length - TRECHO_MAX))
  const fim = Math.min(frase.length, Math.max(antes + TRECHO_MAX, dentro + tamanho))
  const meio = frase.slice(antes, fim).replace(/\s+/g, ' ').trim()
  return `${antes > 0 ? '…' : ''}${meio}${fim < frase.length ? '…' : ''}`
}

/**
 * A ÚLTIMA quantidade que o cliente declarou nas mensagens dele, ou null.
 * `mensagens` em qualquer ordem: a mais recente com quantidade é a que vale
 * (quem disse "menos de 10" e depois "8 camisetas" quer 8).
 */
export function acharQuantidadeDita(mensagens: Array<{ corpo: string | null; criado_em: string }>): QuantidadeDita | null {
  const ordenadas = [...mensagens].sort((a, b) => new Date(b.criado_em).getTime() - new Date(a.criado_em).getTime())
  for (const m of ordenadas) {
    const corpo = (m.corpo ?? '').trim()
    if (!corpo) continue
    const n = COM_NUMERO.exec(corpo)
    if (n) {
      const teto = (n[1] ?? '').toLowerCase()
      const numero = numeroDe(n[2])
      // "menos de 10" é abaixo de 10; "no máximo 10", "até 10", "só 10" podem
      // ser 10 mesmo, então só contam como abaixo quando o número já é < 10.
      const abaixoDoMinimo = numero != null && (numero < MINIMO_POR_MODELO_E_COR || (/^menos/.test(teto) && numero <= MINIMO_POR_MODELO_E_COR))
      return { trecho: fraseComOTrecho(corpo, n.index, n[0].length), criado_em: m.criado_em, numero, abaixoDoMinimo }
    }
    const q = QUALITATIVA.exec(corpo)
    if (q) {
      return { trecho: fraseComOTrecho(corpo, q.index, q[0].length), criado_em: m.criado_em, numero: null, abaixoDoMinimo: true }
    }
  }
  return null
}
