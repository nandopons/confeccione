// app/api/cron/expirar-creditos-avulsos/route.ts
// ============================================================================
// Cron diário: marca lotes em creditos_avulsos como expirados.
//
// Schedule: 0 6 * * *  (6h UTC = 3h BRT) — definido em vercel.json.
//
// Soft delete via UPDATE: preserva histórico pra auditoria. Caller (UI,
// listarLotesAtivos, consumir_credito_avulso) já filtra expirado_em IS NULL.
//
// Auth: Bearer CRON_SECRET no header Authorization (padrão Vercel Cron) OU
//       ?secret= no query string (fallback pra teste manual via curl).
// ============================================================================

import { NextRequest, NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/app/lib/supabase-server'

export async function GET(req: NextRequest) {
  // ─────────────────────────────────────────────────────────────
  // Auth
  // ─────────────────────────────────────────────────────────────
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[cron/expirar-creditos-avulsos] CRON_SECRET ausente no env')
    return NextResponse.json(
      { erro: 'Configuração inválida' },
      { status: 500 }
    )
  }

  const bearerOk = req.headers.get('authorization') === `Bearer ${secret}`
  const queryOk = req.nextUrl.searchParams.get('secret') === secret
  if (!bearerOk && !queryOk) {
    return NextResponse.json({ erro: 'unauthorized' }, { status: 401 })
  }

  // ─────────────────────────────────────────────────────────────
  // Expiração
  // ─────────────────────────────────────────────────────────────
  const inicio = Date.now()
  const agora = new Date().toISOString()

  try {
    const { data, error } = await supabaseAdmin
      .from('creditos_avulsos')
      .update({ expirado_em: agora })
      .lte('expira_em', agora)
      .is('expirado_em', null)
      .gt('quantidade_disponivel', 0)
      .select('id')

    if (error) throw error

    const expirados = data?.length ?? 0
    const duracaoMs = Date.now() - inicio
    console.log(
      `[cron/expirar-creditos-avulsos] ${expirados} lotes expirados em ${duracaoMs}ms`
    )
    registrarExecucao({ ok: true, duracaoMs, detectados: expirados })

    return NextResponse.json({
      ok: true,
      expirados,
      duracao_ms: duracaoMs,
    })
  } catch (err) {
    const duracaoMs = Date.now() - inicio
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[cron/expirar-creditos-avulsos] erro:', err)
    registrarExecucao({ ok: false, duracaoMs, detectados: 0, mensagemErro: msg })

    return NextResponse.json(
      { ok: false, erro: msg, duracao_ms: duracaoMs },
      { status: 500 }
    )
  }
}

// ============================================================================
// Helper interno — observabilidade (mesmo padrão de detectar-gaps)
// ============================================================================

function registrarExecucao(params: {
  ok: boolean
  duracaoMs: number
  detectados: number
  mensagemErro?: string
}) {
  after(async () => {
    try {
      const { error } = await supabaseAdmin.from('cron_execucoes').insert({
        nome_cron: 'expirar-creditos-avulsos',
        duracao_ms: params.duracaoMs,
        ok: params.ok,
        detectados: params.detectados,
        mensagem_erro: params.mensagemErro ?? null,
      })
      if (error) {
        console.error(
          '[cron/expirar-creditos-avulsos] INSERT cron_execucoes falhou:',
          error
        )
      }
    } catch (err) {
      console.error(
        '[cron/expirar-creditos-avulsos] INSERT cron_execucoes exception:',
        err
      )
    }
  })
}
