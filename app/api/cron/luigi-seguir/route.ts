// GET /api/cron/luigi-seguir — a cada minuto: o Luigi volta com "ficou alguma
// dúvida?" nas conversas em que ele respondeu uma pergunta do cliente e ninguém
// falou mais nos 3 minutos seguintes. Ver `armarSeguir` e
// `seguirConversasParadas` em app/lib/luigi.ts (25/09/2026).
//
// Por que cron e não esperar dentro do turno: o turno roda no after() do
// webhook, cujo orçamento de 300 s já é dividido entre debounce, geração de
// imagem e resumo. Três minutos de sono ali estourariam o pior caso.
//
// A rota é leve: um SELECT nas conversas com marca vencida (índice parcial),
// quase sempre vazio. Cada marca é cumprida ou desarmada uma vez.
import { NextRequest, NextResponse } from 'next/server'
import { seguirConversasParadas } from '@/app/lib/luigi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const segredo = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (segredo && auth !== `Bearer ${segredo}`) {
    return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  }
  try {
    return NextResponse.json({ ok: true, ...(await seguirConversasParadas()) })
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e)
    console.error('[cron/luigi-seguir] falhou', { erro })
    return NextResponse.json({ ok: false, erro }, { status: 500 })
  }
}
