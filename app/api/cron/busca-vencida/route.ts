// GET /api/cron/busca-vencida — a cada hora: pedido liberado há mais de 7 dias
// sem confecção → pergunta ao cliente se continua a busca; 2 dias sem resposta
// → pergunta de novo; mais 2 → encerra. Qualquer resposta renova por 7 dias.
// Ver app/lib/busca-fornecedor-validade.ts (25/09/2026, regra do Fernando).
import { NextRequest, NextResponse } from 'next/server'
import { rodarBuscaVencida } from '@/app/lib/busca-fornecedor-validade'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const segredo = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (segredo && auth !== `Bearer ${segredo}`) {
    return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  }
  try {
    return NextResponse.json({ ok: true, ...(await rodarBuscaVencida()) })
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e)
    console.error('[cron/busca-vencida] falhou', { erro })
    return NextResponse.json({ ok: false, erro }, { status: 500 })
  }
}
