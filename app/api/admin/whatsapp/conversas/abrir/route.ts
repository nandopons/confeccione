// app/api/admin/whatsapp/conversas/abrir/route.ts
// ============================================================================
// POST { telefone, nome? } → { conversaId }
//
// Abre (ou cria) a conversa do inbox pra um telefone qualquer — usado pelos
// deep-links do admin (ex.: botão "Conversar" em Pedidos & Ofertas).
// Cria wa_contatos/wa_conversas se ainda não existem, vinculando o contato
// a contas_clientes/leads_fornecedores pelos últimos 8 dígitos (mesma regra
// do webhook).
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { normalizarWaId } from '@/app/lib/whatsapp-cloud'

export const dynamic = 'force-dynamic'

async function vincularContato(waId: string): Promise<{ clienteId: string | null; fornecedorId: string | null }> {
  const last8 = waId.slice(-8)
  const bate = (tel: string | null) => {
    if (!tel) return false
    const dig = tel.replace(/\D/g, '')
    return dig.endsWith(last8) || waId.endsWith(dig.slice(-8))
  }

  const [clientes, fornecedores] = await Promise.all([
    supabaseAdmin.from('contas_clientes').select('id, whatsapp').ilike('whatsapp', `%${last8}`).limit(2),
    supabaseAdmin.from('leads_fornecedores').select('id, whatsapp').ilike('whatsapp', `%${last8}`).limit(2),
  ])

  const cliente = (clientes.data ?? []).find((c) => bate(c.whatsapp))
  const fornecedor = (fornecedores.data ?? []).find((f) => bate(f.whatsapp))
  return { clienteId: cliente?.id ?? null, fornecedorId: fornecedor?.id ?? null }
}

export async function POST(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  }

  let body: { telefone?: string; nome?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 })
  }

  const waId = normalizarWaId(String(body.telefone ?? ''))
  if (waId.replace(/\D/g, '').length < 10) {
    return NextResponse.json({ erro: 'Telefone inválido' }, { status: 400 })
  }
  const nome = (body.nome ?? '').trim() || null

  // ------------------------------------------------------------- contato
  const { data: contatoExistente } = await supabaseAdmin
    .from('wa_contatos')
    .select('id, nome')
    .eq('wa_id', waId)
    .maybeSingle()

  let contatoId = contatoExistente?.id as string | undefined

  if (!contatoId) {
    const { clienteId, fornecedorId } = await vincularContato(waId)
    const { data: novo, error } = await supabaseAdmin
      .from('wa_contatos')
      .insert({ wa_id: waId, nome, cliente_id: clienteId, fornecedor_id: fornecedorId })
      .select('id')
      .single()
    if (error) {
      const { data: retry } = await supabaseAdmin.from('wa_contatos').select('id').eq('wa_id', waId).maybeSingle()
      contatoId = retry?.id
    } else {
      contatoId = novo.id
    }
  } else if (nome && !contatoExistente?.nome) {
    // Só preenche o nome se o contato ainda não tem um (perfil do WhatsApp manda).
    await supabaseAdmin.from('wa_contatos').update({ nome }).eq('id', contatoId)
  }

  if (!contatoId) return NextResponse.json({ erro: 'Falha ao criar contato' }, { status: 500 })

  // ------------------------------------------------------------- conversa
  const { data: conversaExistente } = await supabaseAdmin
    .from('wa_conversas')
    .select('id')
    .eq('contato_id', contatoId)
    .maybeSingle()

  if (conversaExistente?.id) return NextResponse.json({ conversaId: conversaExistente.id })

  const { data: nova, error: convErr } = await supabaseAdmin
    .from('wa_conversas')
    .insert({ contato_id: contatoId })
    .select('id')
    .single()

  if (convErr || !nova) {
    const { data: retry } = await supabaseAdmin.from('wa_conversas').select('id').eq('contato_id', contatoId).maybeSingle()
    if (retry?.id) return NextResponse.json({ conversaId: retry.id })
    return NextResponse.json({ erro: 'Falha ao criar conversa' }, { status: 500 })
  }

  return NextResponse.json({ conversaId: nova.id })
}
