// app/api/pedido/assistente/criar/route.ts
// ============================================================================
// POST /api/pedido/assistente/criar — grava o pedido montado no chat assistido.
//
// Etapa 1: apenas PERSISTE (linhas + contato) na tabela pedidos_assistente via
// service role. NÃO dispara fornecedores — a próxima etapa (visualizador) é que
// vai consumir esse registro. Idempotência leve: o cliente envia o pedido só
// quando o fluxo fica completo.
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getContaAtual } from '@/app/lib/cliente-auth'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const TamanhoSchema = z.object({
  tamanho: z.string().min(1),
  qtd: z.number().int().positive().nullable(),
})
const LinhaSchema = z.object({
  modelo: z.string().nullable(),
  cor: z.string().nullable(),
  material: z.string().nullable(),
  total: z.number().int().positive().nullable(),
  tamanhos: z.array(TamanhoSchema).default([]),
  descricao: z.string().nullable(),
})
const ContatoSchema = z.object({
  nome: z.string().nullable(),
  telefone: z.string().nullable(),
  email: z.string().nullable(),
  cep: z.string().nullable(),
  complemento: z.string().nullable(),
})
const BodySchema = z.object({
  linhas: z.array(LinhaSchema),
  contato: ContatoSchema,
  observacoes: z.string().nullable().optional(),
})

export async function POST(req: Request) {
  let bruto: unknown
  try {
    bruto = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 })
  }

  const parsed = BodySchema.safeParse(bruto)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Formato inválido do pedido.' }, { status: 400 })
  }

  const { linhas, contato } = parsed.data

  // Validação mínima: pelo menos 1 linha com modelo + cor + total, e contato básico.
  const linhasValidas = linhas.filter((l) => l.modelo && l.cor && l.total)
  if (linhasValidas.length === 0) {
    return NextResponse.json(
      { error: 'Inclua pelo menos um produto com modelo, cor e quantidade.' },
      { status: 400 }
    )
  }
  if (!contato.nome || !contato.telefone || !contato.email) {
    return NextResponse.json(
      { error: 'Faltam dados de contato (nome, telefone e e-mail).' },
      { status: 400 }
    )
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(contato.email)) {
    return NextResponse.json({ error: 'E-mail inválido.' }, { status: 400 })
  }

  // Conta logada (se houver) — sem bloquear o anônimo.
  let contaId: string | null = null
  try {
    const conta = await getContaAtual()
    contaId = conta?.id ?? null
  } catch {
    contaId = null
  }

  const { data, error } = await supabase
    .from('pedidos_assistente')
    .insert({
      linhas: linhasValidas,
      nome: contato.nome,
      telefone: contato.telefone,
      email: contato.email,
      cep: contato.cep,
      complemento: contato.complemento,
      observacoes: parsed.data.observacoes ?? null,
      status: 'completo',
      origem: 'home_chat',
      conta_id: contaId,
    })
    .select('id')
    .single()

  if (error || !data) {
    console.error('[pedido/assistente/criar] insert falhou:', error)
    return NextResponse.json({ error: error?.message ?? 'Erro ao salvar o pedido.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, id: data.id, protocolo: data.id })
}
