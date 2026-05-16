// app/api/cron/detectar-gaps/route.ts
// ============================================================================
// Cron horário: detecta novos pedidos órfãos.
//
// Schedule: 0 * * * *  (toda hora cheia) — definido em vercel.json.
// Endpoint separado do scheduler principal — blast radius isolado, cadência
// distinta (15min vs 60min), domínio distinto (sistema de órfãos).
//
// Auth: Bearer CRON_SECRET no header Authorization (padrão Vercel Cron) OU
//       ?secret= no query string (fallback pra teste manual via curl).
//
// Nota: Vercel Cron só dispara em production deployments. Em preview o
// endpoint existe mas só é executável via Bearer/secret manual. Confirmado
// na doc Vercel (vercel-ts.md, cron-jobs/quickstart).
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { detectarOrfaos } from '@/app/lib/orfaos'

export async function GET(req: NextRequest) {
  // ─────────────────────────────────────────────────────────────
  // Auth
  // ─────────────────────────────────────────────────────────────
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[cron/detectar-gaps] CRON_SECRET ausente no env')
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

  // ═════════════════════════════════════════════════════════════
  // TODO Sprint 2+: ADICIONAR GUARD DE HORÁRIO COMERCIAL AQUI
  // ═════════════════════════════════════════════════════════════
  // Hoje detectarOrfaos() é silencioso — só write no banco + console.log.
  // Quando notificarClienteOrfao() e notificarAdminOrfao() (em orfaos.ts)
  // virarem email/WhatsApp REAIS, este endpoint VAI ACORDAR PESSOAS de
  // madrugada se rodar 24/7.
  //
  // Adicionar antes da chamada:
  //   import { estaEmHorarioComercial } from '@/app/lib/horario'
  //   if (!estaEmHorarioComercial()) {
  //     return NextResponse.json({ ok: true, skip: 'fora_horario_comercial' })
  //   }
  //
  // A função estaEmHorarioComercial já existe e é usada pelo scheduler
  // principal (app/api/cron/scheduler/route.ts) — basta importar.
  // ═════════════════════════════════════════════════════════════

  // ─────────────────────────────────────────────────────────────
  // Detecção
  // ─────────────────────────────────────────────────────────────
  const inicio = Date.now()

  try {
    const detectados = await detectarOrfaos()
    const duracaoMs = Date.now() - inicio
    console.log(
      `[cron/detectar-gaps] ${detectados.length} órfãos detectados em ${duracaoMs}ms`
    )
    return NextResponse.json({
      ok: true,
      detectados: detectados.length,
      lista: detectados,
      duracao_ms: duracaoMs,
    })
  } catch (err) {
    const duracaoMs = Date.now() - inicio
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[cron/detectar-gaps] erro:', err)
    return NextResponse.json(
      { ok: false, erro: msg, duracao_ms: duracaoMs },
      { status: 500 }
    )
  }
}
