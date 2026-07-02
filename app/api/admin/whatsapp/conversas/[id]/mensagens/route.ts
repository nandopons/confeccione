// app/api/admin/whatsapp/conversas/[id]/mensagens/route.ts
// GET → mensagens da conversa (asc). Zera não-lidas, marca a última mensagem
// do contato como lida no WhatsApp (✓✓ azul) e gera signed URLs pra mídia
// (bucket wa-midia é privado). Suporta ?after=<ISO> pra polling incremental.

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { marcarComoLida } from '@/app/lib/whatsapp-cloud'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  }

  const { id } = await ctx.params
  const after = req.nextUrl.searchParams.get('after')

  let query = supabaseAdmin
    .from('wa_mensagens')
    .select('id, wamid, direcao, tipo, corpo, midia_path, midia_mime, midia_nome, status, erro, template_nome, criado_em')
    .eq('conversa_id', id)
    .order('criado_em', { ascending: true })
    .limit(500)

  if (after) query = query.gt('criado_em', after)

  const { data: mensagens, error } = await query
  if (error) {
    console.error('[wa-admin] listar mensagens falhou', { id, error })
    return NextResponse.json({ erro: 'Falha ao listar mensagens' }, { status: 500 })
  }

  // Signed URLs (1h) pra mídias — bucket privado
  const comMidia = (mensagens ?? []).filter((m) => m.midia_path)
  const urls: Record<string, string> = {}
  if (comMidia.length > 0) {
    const { data: assinadas } = await supabaseAdmin.storage
      .from('wa-midia')
      .createSignedUrls(comMidia.map((m) => m.midia_path as string), 3600)
    for (const a of assinadas ?? []) {
      if (a.signedUrl && a.path) urls[a.path] = a.signedUrl
    }
  }

  const resposta = (mensagens ?? []).map((m) => ({
    ...m,
    midia_url: m.midia_path ? urls[m.midia_path] ?? null : null,
  }))

  // Efeitos de leitura só na carga completa (não no polling incremental)
  if (!after) {
    await supabaseAdmin.from('wa_conversas').update({ nao_lidas: 0 }).eq('id', id)
    const ultimaEntrada = [...(mensagens ?? [])].reverse().find((m) => m.direcao === 'entrada' && m.wamid)
    if (ultimaEntrada?.wamid) await marcarComoLida(ultimaEntrada.wamid)
  } else if (resposta.some((m) => m.direcao === 'entrada')) {
    await supabaseAdmin.from('wa_conversas').update({ nao_lidas: 0 }).eq('id', id)
    const novaEntrada = [...resposta].reverse().find((m) => m.direcao === 'entrada' && m.wamid)
    if (novaEntrada?.wamid) await marcarComoLida(novaEntrada.wamid)
  }

  return NextResponse.json({ mensagens: resposta })
}
