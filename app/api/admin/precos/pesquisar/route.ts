// app/api/admin/precos/pesquisar/route.ts
// ============================================================================
// POST — "pesquisa de mercado" via IA: estima a curva de preço (R$/unidade por
// faixa de quantidade) pra um produto (modelo+material, liso ou estampado).
// Não salva — devolve as faixas pro admin revisar e ajustar antes de gravar.
// Só admin. É uma ESTIMATIVA da IA (não scraping ao vivo).
// ============================================================================

import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'

export const runtime = 'nodejs'

const MODELO = 'claude-sonnet-4-6'
const FAIXAS_PADRAO = [1, 3, 6, 9, 15, 20, 30, 50, 70, 100]

const BodySchema = z.object({
  modelo: z.string().min(1),
  material: z.string().nullable().optional(),
  estampado: z.boolean().default(false),
  faixasQtdMin: z.array(z.number().int().positive()).optional(),
})

function extrairJson(s: string): string {
  let t = s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const i = t.indexOf('{'), f = t.lastIndexOf('}')
  if (i !== -1 && f !== -1 && f > i) t = t.slice(i, f + 1)
  return t
}

export async function POST(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  let bruto: unknown
  try { bruto = await req.json() } catch { return NextResponse.json({ erro: 'Body inválido' }, { status: 400 }) }
  const p = BodySchema.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: 'Informe ao menos o modelo.' }, { status: 400 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ erro: 'IA indisponível (sem ANTHROPIC_API_KEY).' }, { status: 500 })

  const breakpoints = (p.data.faixasQtdMin && p.data.faixasQtdMin.length > 0 ? p.data.faixasQtdMin : FAIXAS_PADRAO)
    .slice()
    .sort((a, b) => a - b)

  const produtoDesc = [
    p.data.modelo,
    p.data.material ? `em ${p.data.material}` : null,
    p.data.estampado ? 'ESTAMPADO (com estampa/print incluído no preço)' : 'LISO (sem estampa)',
  ].filter(Boolean).join(', ')

  const prompt = `Você é especialista em precificação de CONFECÇÃO têxtil no atacado/sob demanda no Brasil (mercado de fabricação de uniformes, camisetas, moda, etc.).

Estime o PREÇO DE VENDA por UNIDADE (em reais), que uma confecção cobraria do cliente final, para o produto:
- ${produtoDesc}

Considere ECONOMIA DE ESCALA: o preço por unidade é MAIS ALTO em quantidades pequenas (1 unidade é caro, próximo de produção sob medida) e vai CAINDO conforme a quantidade aumenta, estabilizando em quantidades grandes. Use valores realistas do mercado brasileiro de confecção em ${new Date().getFullYear()}. Se for estampado, o preço já inclui a estampa.

Gere o preço por unidade para CADA uma destas quantidades mínimas (qtd_min): ${breakpoints.join(', ')}.
Regra: o preço por unidade deve ser estritamente NÃO-CRESCENTE conforme qtd_min aumenta (nunca subir).

Responda SOMENTE um JSON válido (sem markdown), neste formato:
{"faixas": [{"qtd_min": <int>, "preco_centavos": <int>}, ...], "observacao": "<frase curta sobre a faixa de mercado considerada>"}
- preco_centavos = preço por unidade em CENTAVOS (ex.: R$ 39,90 = 3990).
- Inclua uma faixa para cada qtd_min listado, na ordem crescente.`

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
    console.error('[pesquisar] IA falhou:', err)
    return NextResponse.json({ erro: 'A IA não respondeu agora. Tente de novo.' }, { status: 502 })
  }

  const FaixaSchema = z.object({ qtd_min: z.number().int().positive(), preco_centavos: z.number().int().min(0) })
  const RespSchema = z.object({ faixas: z.array(FaixaSchema).min(1), observacao: z.string().optional().default('') })
  let parsed: z.infer<typeof RespSchema> | null = null
  try {
    parsed = RespSchema.parse(JSON.parse(extrairJson(texto)))
  } catch {
    return NextResponse.json({ erro: 'Não consegui interpretar a estimativa. Tente de novo.' }, { status: 502 })
  }

  // garante ordenação e monotonicidade não-crescente do preço
  const faixas = [...parsed.faixas].sort((a, b) => a.qtd_min - b.qtd_min)
  for (let i = 1; i < faixas.length; i++) {
    if (faixas[i].preco_centavos > faixas[i - 1].preco_centavos) {
      faixas[i].preco_centavos = faixas[i - 1].preco_centavos
    }
  }

  return NextResponse.json({ ok: true, faixas, observacao: parsed.observacao })
}
