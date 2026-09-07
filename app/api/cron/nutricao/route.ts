// app/api/cron/nutricao/route.ts
// ============================================================================
// APOSENTADA (set/2026). A nutrição automática virou um fluxo dentro de
// Automação (/admin/marketing → aba Automação, fluxo "Retomada de pedido
// parado"), processado por /api/cron/automacoes.
//
// A rota continua de pé só pra não quebrar chamada antiga: responde ok e não
// envia nada. Manter os dois motores ligados ao mesmo tempo mandaria a mesma
// mensagem duas vezes pro mesmo lead — por isso ela não roda mais.
// A entrada correspondente saiu do vercel.json.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const bearerOk = !!secret && req.headers.get('authorization') === `Bearer ${secret}`
  const queryOk = !!secret && req.nextUrl.searchParams.get('secret') === secret
  if (!bearerOk && !queryOk) {
    return NextResponse.json({ erro: 'unauthorized' }, { status: 401 })
  }
  return NextResponse.json({
    ok: true,
    aposentada: true,
    substituta: '/api/cron/automacoes',
    detalhe: 'A nutrição virou o fluxo "Retomada de pedido parado" na aba Automação.',
  })
}
