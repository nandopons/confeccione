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
         fornecedor:leads_fornecedores (aprovacao_status, reclassificado_em)
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
  type LeadMin = { aprovacao_status: string | null; reclassificado_em: string | null }
  type ContatoBruto = {
    fornecedor_id: string | null
    fornecedor?: LeadMin | LeadMin[] | null
  }
  // O MOTIVO DA ESCALADA TEM QUE APARECER — 11/09/2026.
  //
  // O aviso "Luigi chamou você" dizia QUE ele chamou e nunca POR QUÊ. O motivo
  // ia pro `luigi_whatsapp_log.motivo_escalada` e morria lá: sete diagnósticos
  // corretos sobre a mesma pessoa, nenhum deles legível de onde se trabalha.
  // Diagnóstico que ninguém lê é console.log com outro nome.
  const idsEscalados = (data ?? [])
    .filter((c) => (c as { luigi_escalado_em: string | null }).luigi_escalado_em)
    .map((c) => (c as { id: string }).id)
  const motivoPorConversa = new Map<string, string>()
  if (idsEscalados.length > 0) {
    const { data: logs } = await supabaseAdmin
      .from('luigi_whatsapp_log')
      .select('conversa_id, motivo_escalada, criado_em')
      .in('conversa_id', idsEscalados)
      .eq('escalado', true)
      .not('motivo_escalada', 'is', null)
      .order('criado_em', { ascending: false })
      .limit(400)
    // O primeiro de cada conversa é o mais recente, porque veio ordenado.
    for (const l of (logs ?? []) as Array<{ conversa_id: string; motivo_escalada: string }>) {
      if (!motivoPorConversa.has(l.conversa_id)) motivoPorConversa.set(l.conversa_id, l.motivo_escalada)
    }
  }

  const conversas = (data ?? []).map((c) => {
    const bruto = (c as { contato: unknown }).contato
    const contato = (Array.isArray(bruto) ? bruto[0] : bruto) as ContatoBruto
    const lead = Array.isArray(contato?.fornecedor) ? contato.fornecedor[0] : contato?.fornecedor
    return {
      ...c,
      eh_fornecedor: ehFornecedorClassificado(contato?.fornecedor_id, lead?.aprovacao_status, lead?.reclassificado_em),
      escalada_motivo: motivoPorConversa.get((c as { id: string }).id) ?? null,
    }
  })

  return NextResponse.json({ conversas })
}
