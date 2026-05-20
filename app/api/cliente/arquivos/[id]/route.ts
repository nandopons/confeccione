// app/api/cliente/arquivos/[id]/route.ts
// ============================================================================
// PATCH  /api/cliente/arquivos/[id]  Body: { display_name }
//   Renomeia (display_name). trim + max 200, sem outras validações.
//
// DELETE /api/cliente/arquivos/[id]
//   Remove do Storage (AWAIT) e depois a linha do banco.
//
// Ownership check em AMBOS: WHERE id=$1 AND conta_id=$conta. Cliente A nunca
// mexe em arquivo de cliente B. Não vaza existência (404 igual ao not found).
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { getContaAtual } from '@/app/lib/cliente-auth'
import { BUCKET_ARTES, normalizarDisplayName } from '@/app/lib/arquivos-cliente'
import { splitExtensao } from '@/app/lib/arquivos-format'

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const conta = await getContaAtual()
  if (!conta) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  const { id } = await params

  let body: { display_name?: unknown }
  try {
    body = (await req.json().catch(() => ({}))) as { display_name?: unknown }
  } catch {
    body = {}
  }
  if (typeof body.display_name !== 'string' || body.display_name.trim().length === 0) {
    return NextResponse.json({ erro: 'Nome inválido' }, { status: 400 })
  }
  const displayName = normalizarDisplayName(body.display_name)

  // Ownership + storage_path pra validar a extensão. Cliente só edita o nome
  // base; a extensão é imutável (impede forjar display_name='hack.exe').
  const { data: arquivo } = await supabaseAdmin
    .from('arquivos_cliente')
    .select('storage_path')
    .eq('id', id)
    .eq('conta_id', conta.id)
    .maybeSingle<{ storage_path: string }>()

  if (!arquivo) {
    return NextResponse.json({ erro: 'Arquivo não encontrado' }, { status: 404 })
  }

  const extOriginal = splitExtensao(arquivo.storage_path).ext.toLowerCase()
  const extNova = splitExtensao(displayName).ext.toLowerCase()
  if (extOriginal !== extNova) {
    return NextResponse.json(
      { erro: 'A extensão do arquivo não pode ser alterada' },
      { status: 400 },
    )
  }

  const { data: atualizado, error } = await supabaseAdmin
    .from('arquivos_cliente')
    .update({ display_name: displayName, atualizado_em: new Date().toISOString() })
    .eq('id', id)
    .eq('conta_id', conta.id)
    .select('id, display_name, mime_type, tamanho_bytes, criado_em')
    .maybeSingle()

  if (error) {
    console.error('[arquivos PATCH] update falhou:', error)
    return NextResponse.json({ erro: 'Erro ao renomear' }, { status: 500 })
  }
  if (!atualizado) {
    return NextResponse.json({ erro: 'Arquivo não encontrado' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, arquivo: atualizado })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const conta = await getContaAtual()
  if (!conta) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  const { id } = await params

  // Ownership: busca a linha garantindo que pertence à conta
  const { data: arquivo } = await supabaseAdmin
    .from('arquivos_cliente')
    .select('id, storage_path')
    .eq('id', id)
    .eq('conta_id', conta.id)
    .maybeSingle<{ id: string; storage_path: string }>()

  if (!arquivo) {
    return NextResponse.json({ erro: 'Arquivo não encontrado' }, { status: 404 })
  }

  // Remove do Storage primeiro (AWAIT) — só apaga a linha se o objeto saiu
  const { error: errRm } = await supabaseAdmin.storage
    .from(BUCKET_ARTES)
    .remove([arquivo.storage_path])

  if (errRm) {
    console.error('[arquivos DELETE] remove storage falhou:', errRm)
    return NextResponse.json({ erro: 'Erro ao remover arquivo' }, { status: 500 })
  }

  const { error: errDel } = await supabaseAdmin
    .from('arquivos_cliente')
    .delete()
    .eq('id', id)
    .eq('conta_id', conta.id)

  if (errDel) {
    console.error('[arquivos DELETE] delete linha falhou:', errDel)
    return NextResponse.json({ erro: 'Erro ao remover arquivo' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
