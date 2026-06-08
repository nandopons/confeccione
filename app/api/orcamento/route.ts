// app/api/orcamento/route.ts
// POST { linhas: [{modelo, material, total, estampas:[{posicao,tamanho}]}] }
// Calcula a estimativa lendo as tabelas de preço. Público (só expõe totais
// calculados das linhas enviadas — preços não são segredo).
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { calcularOrcamento, type PrecoProduto, type PrecoEstampa } from '@/app/lib/orcamento'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const EstampaSchema = z.object({ posicao: z.string(), tamanho: z.string() })
const LinhaSchema = z.object({
  modelo: z.string().nullable().optional(),
  material: z.string().nullable().optional(),
  total: z.number().int().positive().nullable().optional(),
  estampas: z.array(EstampaSchema).optional(),
})
const BodySchema = z.object({ linhas: z.array(LinhaSchema) })

export async function POST(req: Request) {
  let bruto: unknown
  try { bruto = await req.json() } catch { return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 }) }
  const p = BodySchema.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: 'Formato inválido' }, { status: 400 })

  const [prod, est] = await Promise.all([
    supabase.from('precos_produtos').select('chave, faixas'),
    supabase.from('precos_estampas').select('chave, preco_centavos'),
  ])

  const produtos = (prod.data ?? []) as PrecoProduto[]
  const estampas = (est.data ?? []) as PrecoEstampa[]

  const orcamento = calcularOrcamento(
    p.data.linhas.map((l) => ({
      modelo: l.modelo ?? null,
      material: l.material ?? null,
      total: l.total ?? null,
      estampas: l.estampas ?? [],
    })),
    produtos,
    estampas
  )

  // sem nenhuma tabela de preço cadastrada → não dá pra estimar
  const semTabela = produtos.length === 0
  return NextResponse.json({ ok: true, orcamento, semTabela })
}
