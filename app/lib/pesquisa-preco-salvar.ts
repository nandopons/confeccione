// app/lib/pesquisa-preco-salvar.ts
// ============================================================================
// Pesquisa de mercado por IA (pesquisarCurvaPreco) + persistência em
// pesquisas_preco. Usado pelos botões "Pesquisar preço de mercado" dentro do
// gerenciador do pedido (admin e fornecedor). A chave segue exatamente
// chavePesquisa(modelo, material, estampado), pra o engine de orçamento achar.
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import { chavePesquisa } from './orcamento'
import { normMockup } from './mockup-cache'
import { pesquisarCurvaPreco, type FaixaPreco } from './pesquisa-preco'

export type ResultadoPesquisaSalva = {
  ok: boolean
  erro?: string
  chave?: string
  faixas?: FaixaPreco[]
  observacao?: string | null
}

/** Pesquisa a curva de preço (IA) p/ modelo+material+estampado e salva em
 *  pesquisas_preco (upsert por chave). Idempotente — refazer atualiza a curva. */
export async function pesquisarESalvarPreco(input: {
  modelo: string | null
  material: string | null
  estampado: boolean
}): Promise<ResultadoPesquisaSalva> {
  const modelo = (input.modelo ?? '').trim()
  if (!modelo) return { ok: false, erro: 'Produto sem modelo definido — nao da pra pesquisar.' }

  const chave = chavePesquisa(modelo, input.material ?? null, input.estampado)

  const r = await pesquisarCurvaPreco({
    modelo,
    material: input.material ?? null,
    estampado: input.estampado,
  })
  if (!r) return { ok: false, erro: 'A IA nao conseguiu estimar agora. Tente de novo.' }

  const { error } = await supabaseAdmin.from('pesquisas_preco').upsert(
    {
      chave,
      modelo: normMockup(modelo),
      material: normMockup(input.material) || null,
      estampado: input.estampado,
      faixas: r.faixas,
      observacao: r.observacao || null,
      atualizado_em: new Date().toISOString(),
    },
    { onConflict: 'chave' }
  )
  if (error) {
    console.error('[pesquisar-preco] upsert falhou', chave, error)
    return { ok: false, erro: 'Falha ao salvar a pesquisa.' }
  }

  return { ok: true, chave, faixas: r.faixas, observacao: r.observacao || null }
}

/** Maior faixa cujo qtd_min <= qtd (ou a menor, se qtd abaixo de tudo). */
export function precoUnitDaFaixa(faixas: FaixaPreco[] | null | undefined, qtd: number): number | null {
  if (!faixas || faixas.length === 0) return null
  const ord = [...faixas].sort((a, b) => a.qtd_min - b.qtd_min)
  let escolhido: number | null = null
  for (const f of ord) if (qtd >= f.qtd_min) escolhido = f.preco_centavos
  if (escolhido === null) escolhido = ord[0].preco_centavos
  return escolhido
}
