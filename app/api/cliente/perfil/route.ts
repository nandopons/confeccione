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

export async function POST(req: Request) {
  const conta = await getContaAtual()
  if (!conta) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  let body: { nome?: unknown; whatsapp?: unknown }
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
