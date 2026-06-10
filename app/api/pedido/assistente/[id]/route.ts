// app/api/pedido/assistente/[id]/route.ts
// ============================================================================
// PATCH /api/pedido/assistente/[id] — atualiza as linhas do pedido (editar /
// adicionar / excluir produtos no visualizador) e, opcionalmente, o status.
// Via service role. GET devolve o pedido (apoio ao client quando precisar).
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { buscarEnderecoCep } from '@/app/lib/cep'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const TamanhoSchema = z.object({
  tamanho: z.string().min(1),
  qtd: z.number().int().positive().nullable(),
})
const EstampaSchema = z.object({ posicao: z.string(), tamanho: z.string() })
const LinhaSchema = z.object({
  modelo: z.string().nullable(),
  cor: z.string().nullable(),
  material: z.string().nullable(),
  publico: z.string().nullable().optional(),
  total: z.number().int().positive().nullable(),
  tamanhos: z.array(TamanhoSchema).default([]),
  estampas: z.array(EstampaSchema).default([]),
  estampado: z.boolean().nullable().optional(),
  descricao: z.string().nullable(),
})
const ContatoSchema = z.object({
  nome: z.string().trim().min(1).max(120),
  telefone: z.string().trim().max(20).nullable(),
  email: z.string().trim().email().max(160).nullable(),
  cep: z.string().trim().max(10).nullable(),
  complemento: z.string().trim().max(120).nullable(),
})
const PatchSchema = z.object({
  linhas: z.array(LinhaSchema).optional(),
  status: z.enum(['completo', 'em_visualizacao', 'confirmado']).optional(),
  contato: ContatoSchema.optional(),
})

// Resolve logradouro/bairro/cidade/uf pelo CEP (ViaCEP -> BrasilAPI).
const buscarCep = buscarEnderecoCep

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'id ausente.' }, { status: 400 })

  let bruto: unknown
  try {
    bruto = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 })
  }
  const parsed = PatchSchema.safeParse(bruto)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Formato inválido.' }, { status: 400 })
  }

  const patch: Record<string, unknown> = { atualizado_em: new Date().toISOString() }
  if (parsed.data.linhas) {
    const linhasValidas = parsed.data.linhas.filter((l) => l.modelo || l.cor || l.total || l.tamanhos.length > 0)
    if (linhasValidas.length === 0) {
      return NextResponse.json({ error: 'O pedido precisa ter pelo menos um produto.' }, { status: 400 })
    }
    patch.linhas = linhasValidas
  }
  if (parsed.data.status) patch.status = parsed.data.status
  if (parsed.data.contato) {
    const c = parsed.data.contato
    patch.nome = c.nome
    patch.telefone = c.telefone ? c.telefone.replace(/\D/g, '') || null : null
    patch.email = c.email
    const cepDigs = c.cep ? c.cep.replace(/\D/g, '') : ''
    patch.cep = cepDigs || null
    patch.complemento = c.complemento
    if (cepDigs.length === 8) {
      const end = await buscarCep(cepDigs)
      if (end) {
        patch.logradouro = end.logradouro
        patch.bairro = end.bairro
        patch.cidade = end.cidade
        patch.uf = end.uf
      }
    }
  }

  const { data, error } = await supabase
    .from('pedidos_assistente')
    .update(patch)
    .eq('id', id)
    .select('id, linhas, status, nome, telefone, email, cep, complemento, logradouro, bairro, cidade, uf')
    .single()

  if (error || !data) {
    console.error('[pedido/assistente PATCH] falhou:', error)
    return NextResponse.json({ error: error?.message ?? 'Erro ao atualizar.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, pedido: data })
}

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const { data, error } = await supabase
    .from('pedidos_assistente')
    .select('id, linhas, nome, telefone, email, cep, complemento, status, criado_em')
    .eq('id', id)
    .single()
  if (error || !data) {
    return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, pedido: data })
}
