// app/api/admin/whatsapp/conversas/route.ts
// GET → lista de conversas do inbox (mais recentes primeiro), com dados do
// contato e vínculo cliente/fornecedor. Protegida pelo padrão admin.

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  }

  const busca = req.nextUrl.searchParams.get('q')?.trim() ?? ''

  let query = supabaseAdmin
    .from('wa_conversas')
    .select(
      `id, preview, nao_lidas, arquivada, ultima_mensagem_em, ultima_msg_contato_em,
       contato:wa_contatos!inner (id, wa_id, nome, cliente_id, fornecedor_id)`
    )
    .order('ultima_mensagem_em', { ascending: false, nullsFirst: false })
    .limit(200)

  if (busca) {
    const digitos = busca.replace(/\D/g, '')
    query = digitos.length >= 4
      ? query.ilike('contato.wa_id', `%${digitos}%`)
      : query.ilike('contato.nome', `%${busca}%`)
  }

  const { data, error } = await query
  if (error) {
    console.error('[wa-admin] listar conversas falhou', { error })
    return NextResponse.json({ erro: 'Falha ao listar conversas' }, { status: 500 })
  }

  return NextResponse.json({ conversas: data ?? [] })
}
