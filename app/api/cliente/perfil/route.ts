// app/api/cliente/perfil/route.ts
// ============================================================================
// POST /api/cliente/perfil
// Body: { nome?: string, whatsapp?: string }
//
// Atualiza nome e/ou whatsapp da conta do cliente logado.
//
// WhatsApp validado com regex BR: 10 ou 11 dígitos começando com DDD (não
// inclui +55). Normalização (apenasDigitos) garante consistência.
// ============================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { getContaAtual } from '@/app/lib/cliente-auth'

const NOME_MAX = 100
const CEP_MAX = 9
const UF_MAX = 2
const ENDERECO_MAX = 120

// Campos de endereço: string opcional, '' → null, trim, max length.
const CAMPOS_ENDERECO: Array<{ chave: string; max: number }> = [
  { chave: 'cep', max: CEP_MAX },
  { chave: 'numero', max: ENDERECO_MAX },
  { chave: 'complemento', max: ENDERECO_MAX },
  { chave: 'logradouro', max: ENDERECO_MAX },
  { chave: 'bairro', max: ENDERECO_MAX },
  { chave: 'cidade', max: ENDERECO_MAX },
  { chave: 'uf', max: UF_MAX },
]

export async function POST(req: Request) {
  const conta = await getContaAtual()
  if (!conta) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  let body: {
    nome?: unknown
    whatsapp?: unknown
    cep?: unknown
    numero?: unknown
    complemento?: unknown
    logradouro?: unknown
    bairro?: unknown
    cidade?: unknown
    uf?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ erro: 'payload inválido' }, { status: 400 })
  }

  const atualizacao: Record<string, unknown> = {}

  // Nome (opcional). Vazio = limpa.
  if (body.nome !== undefined) {
    if (typeof body.nome !== 'string') {
      return NextResponse.json({ erro: 'nome deve ser string' }, { status: 400 })
    }
    const nomeTrim = body.nome.trim().slice(0, NOME_MAX)
    atualizacao.nome = nomeTrim.length > 0 ? nomeTrim : null
  }

  // WhatsApp (opcional). Vazio = limpa.
  if (body.whatsapp !== undefined) {
    if (typeof body.whatsapp !== 'string') {
      return NextResponse.json(
        { erro: 'whatsapp deve ser string' },
        { status: 400 },
      )
    }
    const digitos = body.whatsapp.replace(/\D/g, '')
    if (digitos.length === 0) {
      // WhatsApp é obrigatório: nunca permite salvar vazio (nem limpar depois).
      return NextResponse.json(
        { erro: 'WhatsApp é obrigatório' },
        { status: 400 },
      )
    } else if (!/^[1-9][0-9]{10,11}$/.test(digitos)) {
      return NextResponse.json(
        { erro: 'WhatsApp inválido (use DDD + número, 10 ou 11 dígitos)' },
        { status: 400 },
      )
    } else {
      atualizacao.whatsapp = digitos
    }
  }

  // Endereço (todos opcionais). Vazio = limpa (null).
  for (const { chave, max } of CAMPOS_ENDERECO) {
    const valor = (body as Record<string, unknown>)[chave]
    if (valor === undefined) continue
    if (typeof valor !== 'string') {
      return NextResponse.json(
        { erro: `${chave} deve ser string` },
        { status: 400 },
      )
    }
    const limpo = valor.trim().slice(0, max)
    atualizacao[chave] = limpo.length > 0 ? limpo : null
  }

  if (Object.keys(atualizacao).length === 0) {
    return NextResponse.json(
      { erro: 'Nenhum campo pra atualizar' },
      { status: 400 },
    )
  }

  atualizacao.atualizado_em = new Date().toISOString()

  const { data: contaAtualizada, error } = await supabaseAdmin
    .from('contas_clientes')
    .update(atualizacao)
    .eq('id', conta.id)
    .select('*')
    .single()

  if (error) {
    console.error('[cliente/perfil] update falhou:', error)
    return NextResponse.json({ erro: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, conta: contaAtualizada })
}
