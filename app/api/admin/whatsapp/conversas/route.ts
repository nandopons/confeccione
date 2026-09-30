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
         fornecedor:leads_fornecedores (nome, aprovacao_status, reclassificado_em)
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
  type LeadMin = { nome: string | null; aprovacao_status: string | null; reclassificado_em: string | null }
  type ContatoBruto = {
    wa_id: string
    nome: string | null
    fornecedor_id: string | null
    fornecedor?: LeadMin | LeadMin[] | null
  }

  // O TÍTULO DA CONVERSA É O NOME QUE A PESSOA ESCREVEU, NÃO O DO PERFIL —
  // 29/09/2026 (Fernando: "o nome que a cliente colocou podia ser o título").
  // A Morenna aparecia como "💕~", o perfil do WhatsApp dela. Quem preencheu
  // um pedido escreveu o próprio nome pra gente; confecção tem o nome do
  // cadastro. Ordem: nome do pedido mais recente (telefone ou telefone
  // digitado) → nome do cadastro de confecção → nome do perfil, se parecer
  // nome de gente → perfil cru → número. O perfil continua em `nome`.
  const waIds = [
    ...new Set(
      (data ?? [])
        .map((c) => {
          const b = (c as { contato: unknown }).contato as ContatoBruto | ContatoBruto[] | null
          return (Array.isArray(b) ? b[0] : b)?.wa_id
        })
        .filter((w): w is string => Boolean(w))
    ),
  ]
  const nomePorNumero = new Map<string, string>()
  if (waIds.length > 0) {
    const [porTelefone, porDigitado] = await Promise.all([
      supabaseAdmin.from('pedidos_assistente').select('telefone, nome, criado_em').in('telefone', waIds).not('nome', 'is', null).order('criado_em', { ascending: false }).limit(400),
      supabaseAdmin.from('pedidos_assistente').select('telefone_digitado, nome, criado_em').in('telefone_digitado', waIds).not('nome', 'is', null).order('criado_em', { ascending: false }).limit(400),
    ])
    for (const r of ((porTelefone.data ?? []) as Array<{ telefone: string | null; nome: string | null }>)) {
      if (r.telefone && r.nome?.trim() && !nomePorNumero.has(r.telefone)) nomePorNumero.set(r.telefone, r.nome.trim())
    }
    for (const r of ((porDigitado.data ?? []) as Array<{ telefone_digitado: string | null; nome: string | null }>)) {
      if (r.telefone_digitado && r.nome?.trim() && !nomePorNumero.has(r.telefone_digitado)) nomePorNumero.set(r.telefone_digitado, r.nome.trim())
    }
  }
  const pareceNomeDeGente = (n: string | null | undefined): boolean => {
    const primeiro = (n ?? '').trim().split(/\s+/)[0] ?? ''
    const letras = primeiro.replace(/[^\p{L}'-]/gu, '')
    return letras.length >= 2 && letras.length === primeiro.length
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
    const ehForn = ehFornecedorClassificado(contato?.fornecedor_id, lead?.aprovacao_status, lead?.reclassificado_em)
    const nomeExibicao =
      (ehForn ? lead?.nome?.trim() : null) ||
      nomePorNumero.get(contato?.wa_id ?? '') ||
      (pareceNomeDeGente(contato?.nome) ? contato?.nome?.trim() : null) ||
      contato?.nome?.trim() ||
      null
    return {
      ...c,
      contato: { ...contato, nome_exibicao: nomeExibicao },
      eh_fornecedor: ehForn,
      escalada_motivo: motivoPorConversa.get((c as { id: string }).id) ?? null,
    }
  })

  return NextResponse.json({ conversas })
}
