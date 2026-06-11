// app/api/cron/nutricao/route.ts
// ============================================================================
// Cron diário: nutrição automática de leads do chat (marketing).
//
// Schedule: 0 13 * * *  (13h UTC = 10h BRT) — definido em vercel.json.
// Manda a mensagem simples de reativação pra leads parados, respeitando o
// toggle (marketing_config.nutricao_ativa — padrão DESLIGADO) e as travas
// anti-spam (dias parado, máx. de toques, espaçamento, cap por rodada).
// Tudo que envia fica registrado em contatos_marketing.
//
// Auth: Bearer CRON_SECRET no header Authorization (padrão Vercel Cron) OU
//       ?secret= no query string (fallback pra teste manual via curl).
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { executarNutricao } from '@/app/lib/marketing-contatos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[cron/nutricao] CRON_SECRET ausente no env')
    return NextResponse.json({ erro: 'Configuração inválida' }, { status: 500 })
  }

  const bearerOk = req.headers.get('authorization') === `Bearer ${secret}`
  const queryOk = req.nextUrl.searchParams.get('secret') === secret
  if (!bearerOk && !queryOk) {
    return NextResponse.json({ erro: 'unauthorized' }, { status: 401 })
  }

  const inicio = Date.now()
  const resultado = await executarNutricao() // respeita o toggle
  console.log('[cron/nutricao] rodada concluída', { ...resultado, ms: Date.now() - inicio })
  return NextResponse.json({ ok: true, ...resultado })
}
