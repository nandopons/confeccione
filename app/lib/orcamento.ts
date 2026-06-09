// app/lib/orcamento.ts
// ============================================================================
// Motor de cálculo do orçamento (estimativa) — modelo UNIFICADO.
// Cada produto é precificado por (modelo + material + variante liso/estampado),
// com uma curva de preço unitário por faixa de quantidade (tabela
// pesquisas_preco). A linha é "estampada" se tiver ao menos uma estampa.
// Comissão da Confeccione = 3%, EMBUTIDA (total = preço; 3% é a margem).
// ============================================================================

import { normMockup } from '@/app/lib/mockup-cache'

export const COMISSAO_PCT = 0.03
export const DESC_QTD_PCT = 0.05          // desconto por quantidade
export const QTD_MIN_DESC = 10            // acima de 10 peças
export const DESC_PIX_PCT = 0.03          // desconto pagamento via PIX
export const FRETE_GRATIS_MIN_CENTAVOS = 20000 // frete grátis a partir de R$ 200

export type Faixa = { qtd_min: number; preco_centavos: number }
export type PesquisaPreco = { chave: string; faixas: Faixa[] }

export type EstampaLinha = { posicao: string; tamanho: string }
export type LinhaOrcamento = {
  modelo: string | null
  material: string | null
  total: number | null
  estampas?: EstampaLinha[]
  estampado?: boolean | null
}

export type LinhaResultado = {
  label: string
  qtd: number
  estampado: boolean
  unit_centavos: number | null
  total_centavos: number
  faltando: string[]
}

export type Orcamento = {
  linhas: LinhaResultado[]
  subtotal_centavos: number        // soma das linhas (antes dos descontos)
  desconto_qtd_centavos: number    // desconto por quantidade (>10 un)
  total_centavos: number           // subtotal - desconto qtd (valor do pedido / preço no cartão)
  pix_centavos: number             // total com o desconto de 3% do PIX
  total_pecas: number
  frete_gratis: boolean            // total >= R$ 200
  comissao_centavos: number
  repasse_centavos: number
  completo: boolean
}

// Adicional OCULTO por urgência do prazo de produção (não explicitado ao cliente).
// <=5 dias: +20% · 6-20 dias: +10% · >=21 dias: sem adicional.
export function prazoMultiplicador(prazoDias: number | null | undefined): number {
  if (prazoDias == null || !Number.isFinite(prazoDias)) return 1
  if (prazoDias <= 5) return 1.2
  if (prazoDias <= 20) return 1.1
  return 1
}

export function chavePesquisa(modelo: string | null, material: string | null, estampado: boolean): string {
  return `${normMockup(modelo)}|${normMockup(material)}|${estampado ? 'estampado' : 'liso'}`
}

/** Maior faixa cujo qtd_min <= quantidade (ou a menor faixa se qtd abaixo). */
function precoDaFaixa(faixas: Faixa[], qtd: number): number | null {
  const ord = [...faixas].sort((a, b) => a.qtd_min - b.qtd_min)
  let escolhido: number | null = null
  for (const f of ord) if (qtd >= f.qtd_min) escolhido = f.preco_centavos
  if (escolhido === null && ord.length > 0) escolhido = ord[0].preco_centavos
  return escolhido
}

export function calcularOrcamento(linhas: LinhaOrcamento[], pesquisas: PesquisaPreco[], prazoDias?: number | null): Orcamento {
  const mult = prazoMultiplicador(prazoDias)
  const map = new Map(pesquisas.map((p) => [p.chave, p]))

  const resultado: LinhaResultado[] = []
  let total = 0
  let totalPecas = 0
  let completo = true

  for (const l of linhas) {
    const qtd = l.total && l.total > 0 ? l.total : 0
    totalPecas += qtd
    const estampado = l.estampado === true || (l.estampas?.length ?? 0) > 0
    const label = ([l.modelo, l.material].filter(Boolean).join(' · ') || 'Produto') + (estampado ? ' (estampado)' : '')
    const faltando: string[] = []

    const pesq = map.get(chavePesquisa(l.modelo, l.material, estampado))
    const unitBase = pesq ? precoDaFaixa(pesq.faixas, qtd || 1) : null
    if (unitBase === null) faltando.push(estampado ? 'preço (estampado)' : 'preço (liso)')
    // adicional de urgência embutido no unitário (oculto)
    const unit = unitBase === null ? null : Math.round(unitBase * mult)

    const totalLinha = unit === null ? 0 : unit * qtd
    if (faltando.length > 0) completo = false
    total += totalLinha

    resultado.push({
      label: String(label),
      qtd,
      estampado,
      unit_centavos: unit,
      total_centavos: totalLinha,
      faltando,
    })
  }

  const subtotal = total
  const descontoQtd = totalPecas > QTD_MIN_DESC ? Math.round(subtotal * DESC_QTD_PCT) : 0
  const totalFinal = subtotal - descontoQtd          // valor do pedido (cartão paga isso)
  const pix = Math.round(totalFinal * (1 - DESC_PIX_PCT)) // PIX paga isso (−3%)
  const comissao = Math.round(totalFinal * COMISSAO_PCT)
  return {
    linhas: resultado,
    subtotal_centavos: subtotal,
    desconto_qtd_centavos: descontoQtd,
    total_centavos: totalFinal,
    pix_centavos: pix,
    total_pecas: totalPecas,
    frete_gratis: totalFinal >= FRETE_GRATIS_MIN_CENTAVOS,
    comissao_centavos: comissao,
    repasse_centavos: totalFinal - comissao,
    completo,
  }
}
