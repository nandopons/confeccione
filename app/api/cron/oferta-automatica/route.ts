// GET /api/cron/oferta-automatica — roda a fila de oferta a fornecedor.
//
// Uma confecção por vez, 3 horas comerciais pra responder (menos se o prazo do
// pedido aperta), teto de 2 ofertas abertas por confecção. Ver
// app/lib/oferta-automatica.ts.
//
// NASCE DESLIGADA, DE PROPÓSITO
// Esta rota manda WhatsApp real pra fornecedor sem ninguém no meio. No dia em
// que foi escrita (09/09/2026) o número levou o primeiro aviso de "healthy
// ecosystem engagement" da Meta, depois de 43 templates num dia. Ligar junto
// com o deploy seria empilhar disparo automático em cima disso, sem ninguém
// olhando.
//
// Pra ligar: OFERTA_AUTOMATICA_ATIVA=1 na Vercel. Pra desligar num susto: tira
// a env. Nenhum dos dois exige deploy.
//
// Enquanto está desligada a rota ainda EXPIRA as ofertas vencidas — isso não
// escreve pra ninguém e mantém o estado limpo pro dia em que ligar.
import { NextRequest, NextResponse } from 'next/server'
import { rodarFilaDeOfertas } from '@/app/lib/oferta-automatica'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const segredo = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (segredo && auth !== `Bearer ${segredo}`) {
    return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  }

  if (process.env.OFERTA_AUTOMATICA_ATIVA !== '1') {
    return NextResponse.json({
      ok: true,
      desligada: true,
      observacao: 'defina OFERTA_AUTOMATICA_ATIVA=1 na Vercel pra ligar a fila',
    })
  }

  try {
    return NextResponse.json({ ok: true, ...(await rodarFilaDeOfertas()) })
  } catch (e) {
    // Falhar aqui não pode ficar só no log: é fila que decide quem recebe
    // pedido, e "não mandou nada hoje" precisa ter causa visível.
    const erro = e instanceof Error ? e.message : String(e)
    console.error('[cron/oferta-automatica] falhou', { erro })
    return NextResponse.json({ ok: false, erro }, { status: 500 })
  }
}
