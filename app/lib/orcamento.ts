// app/lib/orcamento.ts
// ============================================================================
// Motor de cálculo do orçamento (estimativa). Puro: recebe as linhas do pedido
// e as tabelas de preço, devolve o detalhamento. Comissão da Confeccione = 3%,
// EMBUTIDA: o total mostrado ao cliente é o preço cheio; internamente 3% é a
// margem da Confeccione e 97% o repasse ao fornecedor.
// ============================================================================

import { normMockup } from '@/app/lib/mockup-cache'

export const COMISSAO_PCT = 0.03

export type Faixa = { qtd_min: number; preco_centavos: number }
export type PrecoProduto = { chave: string; faixas: Faixa[] }
export type PrecoEstampa = { chave: string; preco_centavos: number }

export type EstampaLinha = { posicao: string; tamanho: string }
export type LinhaOrcamento = {
  modelo: string | null
  material: string | null
  total: number | null
  estampas?: EstampaLinha[]
}

export type LinhaResultado = {
  label: string
  qtd: number
  unit_base_centavos: number | null
  unit_estampas_centavos: number
  unit_centavos: number | null
  total_centavos: number
  faltando: string[] // o que não tem preço cadastrado
}

export type Orcamento = {
  linhas: LinhaResultado[]
  total_centavos: number
  comissao_centavos: number
  repasse_centavos: number
  completo: boolean // true se TODOS os itens têm preço
}

function chaveProduto(modelo: string | null, material: string | null): string {
  return `${normMockup(modelo)}|${normMockup(material)}`
}
function chaveEstampa(posicao: string, tamanho: string): string {
  return `${normMockup(posicao)}|${normMockup(tamanho)}`
}

/** Escolhe o preço unitário da maior faixa cujo qtd_min <= quantidade. */
function precoDaFaixa(faixas: Faixa[], qtd: number): number | null {
  const ordenadas = [...faixas].sort((a, b) => a.qtd_min - b.qtd_min)
  let escolhido: number | null = null
  for (const f of ordenadas) {
    if (qtd >= f.qtd_min) escolhido = f.preco_centavos
  }
  // se a qtd for menor que a menor faixa, usa a menor faixa como base
  if (escolhido === null && ordenadas.length > 0) escolhido = ordenadas[0].preco_centavos
  return escolhido
}

export function calcularOrcamento(
  linhas: LinhaOrcamento[],
  produtos: PrecoProduto[],
  estampas: PrecoEstampa[]
): Orcamento {
  const mapProd = new Map(produtos.map((p) => [p.chave, p]))
  const mapEst = new Map(estampas.map((e) => [e.chave, e]))

  const resultado: LinhaResultado[] = []
  let total = 0
  let completo = true

  for (const l of linhas) {
    const qtd = l.total && l.total > 0 ? l.total : 0
    const label = [l.modelo, l.material].filter(Boolean).join(' · ') || 'Produto'
    const faltando: string[] = []

    const prod = mapProd.get(chaveProduto(l.modelo, l.material))
    const unitBase = prod ? precoDaFaixa(prod.faixas, qtd || 1) : null
    if (unitBase === null) faltando.push('preço do produto')

    let unitEstampas = 0
    for (const est of l.estampas ?? []) {
      const pe = mapEst.get(chaveEstampa(est.posicao, est.tamanho))
      if (pe) unitEstampas += pe.preco_centavos
      else faltando.push(`estampa ${est.posicao}/${est.tamanho}`)
    }

    const unit = unitBase === null ? null : unitBase + unitEstampas
    const totalLinha = unit === null ? 0 : unit * qtd
    if (faltando.length > 0) completo = false
    total += totalLinha

    resultado.push({
      label,
      qtd,
      unit_base_centavos: unitBase,
      unit_estampas_centavos: unitEstampas,
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
