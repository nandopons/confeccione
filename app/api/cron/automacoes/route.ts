// GET /api/cron/automacoes — roda todos os fluxos ativos.
// Cada rodada inscreve quem passou a ser elegível e manda os passos vencidos,
// respeitando janela de horário, teto de toques e cap por rodada.
import { NextRequest, NextResponse } from 'next/server'
import { rodarTodasAutomacoes } from '@/app/lib/automacoes-marketing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const segredo = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (segredo && auth !== `Bearer ${segredo}`) {
    return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  }
  return NextResponse.json({ ok: true, fluxos: await rodarTodasAutomacoes() })
}
