// app/lib/pesquisa-preco.ts
// ============================================================================
// "Pesquisa de mercado" por IA: estima a curva de preço (R$/un por faixa de
// quantidade) de um produto (modelo+material, liso/estampado). Reutilizado pelo
// endpoint admin e pela pesquisa automática (ao entrar no visualizador).
// É uma ESTIMATIVA da IA — não scraping ao vivo.
// ============================================================================

import Anthropic from '@anthropic-ai/sdk'

const MODELO = 'claude-sonnet-4-6'
export const FAIXAS_PADRAO = [1, 3, 6, 9, 15, 20, 30, 50, 70, 100]

export type FaixaPreco = { qtd_min: number; preco_centavos: number }
export type ResultadoPesquisa = { faixas: FaixaPreco[]; observacao: string }

function extrairJson(s: string): string {
  let t = s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const i = t.indexOf('{'), f = t.lastIndexOf('}')
  if (i !== -1 && f !== -1 && f > i) t = t.slice(i, f + 1)
  return t
}

export async function pesquisarCurvaPreco(input: {
  modelo: string
  material: string | null
  estampado: boolean
  breakpoints?: number[]
}): Promise<ResultadoPesquisa | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null

  const breakpoints = (input.breakpoints && input.breakpoints.length > 0 ? input.breakpoints : FAIXAS_PADRAO)
    .slice()
    .sort((a, b) => a - b)

  const produtoDesc = [
    input.modelo,
    input.material ? `em ${input.material}` : null,
    input.estampado ? 'ESTAMPADO (com estampa/print incluído no preço)' : 'LISO (sem estampa)',
  ].filter(Boolean).join(', ')

  const prompt = `Você é especialista em precificação de CONFECÇÃO têxtil no atacado/sob demanda no Brasil (uniformes, camisetas, moda, etc.).

Estime o PREÇO DE VENDA por UNIDADE (em reais) que uma confecção cobraria do cliente final, para: ${produtoDesc}.

Considere ECONOMIA DE ESCALA: preço por unidade MAIS ALTO em quantidades pequenas (1 un é caro, próximo de produção sob medida) e CAINDO conforme a quantidade aumenta, estabilizando em quantidades grandes. Valores realistas do mercado brasileiro em ${new Date().getFullYear()}. Se estampado, o preço já inclui a estampa.

Dê o preço por unidade para CADA quantidade mínima (qtd_min): ${breakpoints.join(', ')}. O preço por unidade deve ser NÃO-CRESCENTE conforme qtd_min aumenta.

Responda SOMENTE JSON válido (sem markdown):
{"faixas": [{"qtd_min": <int>, "preco_centavos": <int>}, ...], "observacao": "<frase curta da faixa de mercado>"}
- preco_centavos = preço por unidade em CENTAVOS (R$ 39,90 = 3990).`

  let texto: string
  try {
    const client = new Anthropic({ apiKey })
    const r = await client.messages.create({
      model: MODELO,
      max_tokens: 900,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
    })
    texto = r.content.filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text').map((b) => b.text).join('')
  } catch (err) {
    console.error('[pesquisa-preco] IA falhou:', err)
    return null
  }

  let obj: { faixas?: Array<{ qtd_min?: unknown; preco_centavos?: unknown }>; observacao?: unknown }
  try {
    obj = JSON.parse(extrairJson(texto))
  } catch {
    return null
  }
  if (!obj.faixas || !Array.isArray(obj.faixas)) return null

  const faixas: FaixaPreco[] = obj.faixas
    .map((f) => ({ qtd_min: Number(f.qtd_min), preco_centavos: Number(f.preco_centavos) }))
    .filter((f) => Number.isFinite(f.qtd_min) && f.qtd_min > 0 && Number.isFinite(f.preco_centavos) && f.preco_centavos >= 0)
    .sort((a, b) => a.qtd_min - b.qtd_min)
  if (faixas.length === 0) return null

  // monotonicidade não-crescente
  for (let i = 1; i < faixas.length; i++) {
    if (faixas[i].preco_centavos > faixas[i - 1].preco_centavos) {
      faixas[i].preco_centavos = faixas[i - 1].preco_centavos
    }
  }

  return { faixas, observacao: typeof obj.observacao === 'string' ? obj.observacao : '' }
}
