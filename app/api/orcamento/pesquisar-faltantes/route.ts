// app/api/orcamento/pesquisar-faltantes/route.ts
// ============================================================================
// POST { linhas } — para cada produto (modelo+material+liso/estampado) SEM preço
// cadastrado, dispara a pesquisa de mercado por IA e SALVA em pesquisas_preco.
// Depois recalcula e devolve o orçamento. Chamado ao entrar no visualizador,
// pra a estimativa fechar sozinha enquanto o cliente finaliza o pedido.
// Público; limita o nº de pesquisas por chamada.
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { calcularOrcamento, chavePesquisa, type PesquisaPreco } from '@/app/lib/orcamento'
import { pesquisarCurvaPreco } from '@/app/lib/pesquisa-preco'
import { normMockup } from '@/app/lib/mockup-cache'

export const runtime = 'nodejs'
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const MAX_PESQUISAS = 8

const EstampaSchema = z.object({ posicao: z.string(), tamanho: z.string() })
const LinhaSchema = z.object({
  modelo: z.string().nullable().optional(),
  material: z.string().nullable().optional(),
  total: z.number().int().positive().nullable().optional(),
  estampas: z.array(EstampaSchema).optional(),
  estampado: z.boolean().nullable().optional(),
})
const BodySchema = z.object({ linhas: z.array(LinhaSchema), prazoDias: z.number().int().nullable().optional() })

export async function POST(req: Request) {
  let bruto: unknown
  try { bruto = await req.json() } catch { return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 }) }
  const p = BodySchema.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: 'Formato inválido' }, { status: 400 })

  // combos distintos que precisam de preço (modelo presente)
  const combos = new Map<string, { modelo: string; material: string | null; estampado: boolean }>()
  for (const l of p.data.linhas) {
    if (!l.modelo || !l.modelo.trim()) continue
    const estampado = l.estampado === true || (l.estampas?.length ?? 0) > 0
    const chave = chavePesquisa(l.modelo, l.material ?? null, estampado)
    if (!combos.has(chave)) combos.set(chave, { modelo: l.modelo, material: l.material ?? null, estampado })
  }

  const { data: existentes } = await supabase.from('pesquisas_preco').select('chave')
  const temPreco = new Set((existentes ?? []).map((r) => r.chave))

  const faltantes = [...combos.entries()].filter(([k]) => !temPreco.has(k)).slice(0, MAX_PESQUISAS)

  let pesquisou = 0
  for (const [chave, c] of faltantes) {
    const r = await pesquisarCurvaPreco({ modelo: c.modelo, material: c.material, estampado: c.estampado })
    if (!r) continue
    const { error } = await supabase.from('pesquisas_preco').upsert(
      {
        chave,
        modelo: normMockup(c.modelo),
        material: normMockup(c.material) || null,
        estampado: c.estampado,
        faixas: r.faixas,
        observacao: r.observacao || null,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: 'chave' }
    )
    if (!error) pesquisou++
  }

  // recalcula com a tabela atualizada
  const { data: pesqData } = await supabase.from('pesquisas_preco').select('chave, faixas')
  const pesquisas = (pesqData ?? []) as PesquisaPreco[]
  const orcamento = calcularOrcamento(
    p.data.linhas.map((l) => ({ modelo: l.modelo ?? null, material: l.material ?? null, total: l.total ?? null, estampas: l.estampas ?? [], estampado: l.estampado ?? null })),
    pesquisas,
    p.data.prazoDias ?? null
  )

  return NextResponse.json({ ok: true, orcamento, pesquisou, semTabela: pesquisas.length === 0 })
}
