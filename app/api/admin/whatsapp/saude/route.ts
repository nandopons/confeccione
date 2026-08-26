// app/api/admin/whatsapp/saude/route.ts
// ============================================================================
// GET → o painel pergunta "os recibos da Meta ainda estão chegando?".
//
// Três medidas baratas (todas com índice em criado_em / status):
//   presas        — saídas velhas ainda em 'enviando'
//   ultimaEntrada — última mensagem recebida de um contato
//   ultimoRecibo  — última saída que saiu de 'enviando'
//
// A decisão em si mora em app/lib/wa-saude.ts, sem banco, pra ser testável.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { diagnosticar, MINUTOS_SEM_CONFIRMACAO } from '@/app/lib/wa-saude'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  }

  const agora = Date.now()
  const limiteVelha = new Date(agora - MINUTOS_SEM_CONFIRMACAO * 60_000).toISOString()
  const limiteJanela = new Date(agora - 7 * 86_400_000).toISOString()

  try {
    const [presasRes, entradaRes, reciboRes] = await Promise.all([
      supabaseAdmin
        .from('wa_mensagens')
        .select('id', { count: 'exact', head: true })
        .eq('direcao', 'saida')
        .eq('status', 'enviando')
        .lt('criado_em', limiteVelha)
        .gt('criado_em', limiteJanela),
      supabaseAdmin
        .from('wa_mensagens')
        .select('criado_em')
        .eq('direcao', 'entrada')
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from('wa_mensagens')
        .select('criado_em')
        .eq('direcao', 'saida')
        .neq('status', 'enviando')
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const diag = diagnosticar(
      {
        presas: presasRes.count ?? 0,
        ultimaEntrada: entradaRes.data?.criado_em ?? null,
        ultimoRecibo: reciboRes.data?.criado_em ?? null,
      },
      agora
    )

    return NextResponse.json(diag)
  } catch (err) {
    // Falha aqui não pode derrubar o inbox: o painel simplesmente não mostra
    // o aviso. Melhor um aviso ausente do que um chat que não abre.
    console.error('[wa-admin] saude falhou', { err })
    return NextResponse.json({ erro: 'indisponivel' }, { status: 503 })
  }
}
