// app/api/cron/captacao-pedidos/route.ts
// ============================================================================
// Cron da captação puxada pelo pedido: 09:00 e 15:00 (Recife) em dia útil —
// horário de gente ler mensagem fria. Pra cada pedido sem fornecedor que
// está na vez (região seguinte, intervalo entre buscas, tetos), o agente
// procura confecções na web e manda a sondagem. Modo e tetos vêm de
// agentes_config ('captacao'); desligado, o cron não faz nada.
//
// Auth: Bearer CRON_SECRET (padrão Vercel Cron) ou ?secret= pra teste manual.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { rodarCaptacaoPedidos } from '@/app/lib/captacao-pedido'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ erro: 'CRON_SECRET ausente' }, { status: 500 })
  const bearerOk = req.headers.get('authorization') === `Bearer ${secret}`
  const queryOk = req.nextUrl.searchParams.get('secret') === secret
  if (!bearerOk && !queryOk) return NextResponse.json({ erro: 'unauthorized' }, { status: 401 })

  const inicio = Date.now()
  try {
    const r = await rodarCaptacaoPedidos('cron')
    return NextResponse.json({ ok: true, duracao_ms: Date.now() - inicio, ...r })
  } catch (err) {
    const erro = err instanceof Error ? err.message : String(err)
    console.error('[cron/captacao-pedidos] falhou', { erro })
    return NextResponse.json({ ok: false, erro }, { status: 500 })
  }
}
