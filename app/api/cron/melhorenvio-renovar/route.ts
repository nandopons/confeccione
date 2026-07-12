// GET /api/cron/melhorenvio-renovar — renova tokens ME expirando em <10 dias.
// Agendado no vercel.json (diário). Protegido pelo CRON_SECRET (padrão Vercel).
import { NextRequest, NextResponse } from 'next/server'
import { renovarContasExpirando } from '@/app/lib/melhorenvio'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  }
  const resultado = await renovarContasExpirando(10)
  return NextResponse.json({ ok: true, ...resultado })
}
