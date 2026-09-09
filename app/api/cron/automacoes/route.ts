// GET /api/cron/automacoes — roda todos os fluxos ativos.
// Cada rodada inscreve quem passou a ser elegível e manda os passos vencidos,
// respeitando janela de horário, teto de toques e cap por rodada.
//
// A SINCRONIZAÇÃO VEM ANTES (09/09/2026)
// Automação trabalha em cima de lead, e lead de pedido novo só existia depois
// que alguém apertasse o botão de sincronizar no /admin. Quem pediu hoje ficava
// fora do fluxo até isso acontecer — os 7 pedidos mais novos parados na etapa
// "captado" não tinham lead nenhum. Sincronizar as últimas horas aqui custa uma
// consulta e fecha esse buraco sem depender de ninguém lembrar.
import { NextRequest, NextResponse } from 'next/server'
import { rodarTodasAutomacoes } from '@/app/lib/automacoes-marketing'
import { sincronizarLeadsRecentes } from '@/app/lib/leads-marketing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const segredo = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (segredo && auth !== `Bearer ${segredo}`) {
    return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  }

  // Janela de 6h com cron de hora em hora: sobreposição de propósito. Se uma
  // rodada falhar, a seguinte cobre o buraco — o upsert é idempotente.
  let sync: unknown
  try {
    sync = await sincronizarLeadsRecentes(6)
  } catch (e) {
    // Falhar aqui não pode impedir os fluxos de rodar pra quem JÁ tem lead.
    sync = { erro: e instanceof Error ? e.message : String(e) }
  }

  return NextResponse.json({ ok: true, sync, fluxos: await rodarTodasAutomacoes() })
}
