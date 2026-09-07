// GET /api/cron/campanhas — leva as campanhas agendadas/em andamento adiante.
// A cada execução prepara o público das que chegaram a hora e manda um lote
// de cada. Protegido por CRON_SECRET (padrão dos outros crons do projeto).
import { NextRequest, NextResponse } from 'next/server'
import { campanhasParaRodar, prepararCampanha, processarCampanha } from '@/app/lib/campanhas-marketing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const segredo = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (segredo && auth !== `Bearer ${segredo}`) {
    return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  }

  const campanhas = await campanhasParaRodar()
  const resultados = []
  for (const c of campanhas) {
    if (c.status === 'agendada') await prepararCampanha(c.id)
    resultados.push(await processarCampanha(c.id))
  }
  return NextResponse.json({ ok: true, campanhas: resultados })
}
