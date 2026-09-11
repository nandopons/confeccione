// app/api/admin/whatsapp/conversas/route.ts
// GET → lista de conversas do inbox (mais recentes primeiro), com dados do
// contato e vínculo cliente/fornecedor. Protegida pelo padrão admin.

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { ehFornecedorClassificado } from '@/app/lib/classificacao-contato'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  }

  const busca = req.nextUrl.searchParams.get('q')?.trim() ?? ''

  let query = supabaseAdmin
    .from('wa_conversas')
    .select(
      `id, preview, nao_lidas, arquivada, ultima_mensagem_em, ultima_msg_contato_em, luigi_escalado_em,
       contato:wa_contatos!inner (
         id, wa_id, nome, cliente_id, fornecedor_id,
         fornecedor:leads_fornecedores (aprovacao_status)
       )`
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

  // O SELO TEM QUE DIZER O MESMO QUE O AGENTE — 11/09/2026.
  //
  // O inbox pintava "Fornecedor" a partir de `contato.fornecedor_id` puro,
  // enquanto o Luigi já passou a exigir que o lead não esteja `reprovado`.
  // Resultado: a tela dizia FORNECEDOR e o agente atendia como cliente, na
  // mesma conversa. Aqui a rota devolve a classificação pronta, calculada pela
  // mesma função que o Luigi usa — a tela não decide mais nada sozinha.
  type ContatoBruto = {
    fornecedor_id: string | null
    fornecedor?: { aprovacao_status: string | null } | Array<{ aprovacao_status: string | null }> | null
  }
  const conversas = (data ?? []).map((c) => {
    const bruto = (c as { contato: unknown }).contato
    const contato = (Array.isArray(bruto) ? bruto[0] : bruto) as ContatoBruto
    const lead = Array.isArray(contato?.fornecedor) ? contato.fornecedor[0] : contato?.fornecedor
    return {
      ...c,
      eh_fornecedor: ehFornecedorClassificado(contato?.fornecedor_id, lead?.aprovacao_status),
    }
  })

  return NextResponse.json({ conversas })
}
