// app/api/orcamento/route.ts
// POST { linhas: [{modelo, material, total, estampas:[{posicao,tamanho}]}] }
// Calcula a estimativa lendo a tabela unificada pesquisas_preco (modelo+
// material+liso/estampado). Público (só devolve totais das linhas enviadas).
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { calcularOrcamento, type PesquisaPreco } from '@/app/lib/orcamento'

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

  const { data } = await supabase.from('pesquisas_preco').select('chave, faixas')
  const pesquisas = (data ?? []) as PesquisaPreco[]

  const orcamento = calcularOrcamento(
    p.data.linhas.map((l) => ({
      modelo: l.modelo ?? null,
      material: l.material ?? null,
      total: l.total ?? null,
      estampas: l.estampas ?? [],
    })),
    pesquisas
  )

  return NextResponse.json({ ok: true, orcamento, semTabela: pesquisas.length === 0 })
}
