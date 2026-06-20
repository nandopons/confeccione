// POST /api/pedido/assistente/[id]/entrega — grava CEP + número (+complemento)
// do pedido e resolve logradouro/bairro/cidade/UF pelo CEP. Público por uuid
// (mesmo padrão do visualizador). Atualiza só o endereço — não toca no contato.
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { buscarEnderecoCep } from '@/app/lib/cep'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const Body = z.object({
  cep: z.string(),
  numero: z.string().nullable().optional(),
  complemento: z.string().nullable().optional(),
})

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ erro: 'id ausente' }, { status: 400 })

  let bruto: unknown
  try { bruto = await req.json() } catch { return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 }) }
  const p = Body.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: 'Dados inválidos' }, { status: 400 })

  const cepDigs = (p.data.cep || '').replace(/\D/g, '')
  if (cepDigs.length !== 8) return NextResponse.json({ erro: 'CEP inválido' }, { status: 400 })

  const patch: Record<string, unknown> = {
    cep: cepDigs,
    numero: p.data.numero?.trim() || null,
    complemento: p.data.complemento?.trim() || null,
    atualizado_em: new Date().toISOString(),
  }
  const end = await buscarEnderecoCep(cepDigs)
  if (end) {
    patch.logradouro = end.logradouro
    patch.bairro = end.bairro
    patch.cidade = end.cidade
    patch.uf = end.uf
  }

  const { error } = await supabase.from('pedidos_assistente').update(patch).eq('id', id)
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
