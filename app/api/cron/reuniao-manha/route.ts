// GET /api/cron/reuniao-manha — 07:00 em Recife (10:00 UTC no vercel.json).
// Monta a pauta da manhã a partir do diário de bordo e manda pro WhatsApp do
// gestor (WHATSAPP_GESTAO_NUMEROS). A reunião em si acontece na conversa,
// pelo agente em app/lib/gestao-whatsapp.ts. Decisão D-7.
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
    const r = await enviarPauta('manha')
    return NextResponse.json({ ok: r.destinos.every((d) => d.ok), ...r })
  } catch (err) {
    const erro = err instanceof Error ? err.message : String(err)
    console.error('[cron/reuniao-manha] falhou', { erro })
    return NextResponse.json({ ok: false, erro }, { status: 500 })
  }
}
