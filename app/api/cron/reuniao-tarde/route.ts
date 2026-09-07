// GET /api/cron/reuniao-tarde — 17:30 em Recife (20:30 UTC no vercel.json).
// Pauta do fechamento do dia pro WhatsApp do gestor. Ver reuniao-manha.
import { NextRequest, NextResponse } from 'next/server'
import { enviarPauta } from '@/app/lib/gestao-whatsapp'

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
    const r = await enviarPauta('tarde')
    return NextResponse.json({ ok: r.destinos.every((d) => d.ok), ...r })
  } catch (err) {
    const erro = err instanceof Error ? err.message : String(err)
    console.error('[cron/reuniao-tarde] falhou', { erro })
    return NextResponse.json({ ok: false, erro }, { status: 500 })
  }
}
