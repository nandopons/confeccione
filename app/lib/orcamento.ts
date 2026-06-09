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
  total_centavos: number
  comissao_centavos: number
  repasse_centavos: number
  completo: boolean
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

export function calcularOrcamento(linhas: LinhaOrcamento[], pesquisas: PesquisaPreco[]): Orcamento {
  const map = new Map(pesquisas.map((p) => [p.chave, p]))

  const resultado: LinhaResultado[] = []
  let total = 0
  let completo = true

  for (const l of linhas) {
    const qtd = l.total && l.total > 0 ? l.total : 0
    const estampado = l.estampado === true || (l.estampas?.length ?? 0) > 0
    const label = ([l.modelo, l.material].filter(Boolean).join(' · ') || 'Produto') + (estampado ? ' (estampado)' : '')
    const faltando: string[] = []

    const pesq = map.get(chavePesquisa(l.modelo, l.material, estampado))
    const unit = pesq ? precoDaFaixa(pesq.faixas, qtd || 1) : null
    if (unit === null) faltando.push(estampado ? 'preço (estampado)' : 'preço (liso)')

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

  const comissao = Math.round(total * COMISSAO_PCT)
  return {
    linhas: resultado,
    total_centavos: total,
    comissao_centavos: comissao,
    repasse_centavos: total - comissao,
    completo,
  }
}
