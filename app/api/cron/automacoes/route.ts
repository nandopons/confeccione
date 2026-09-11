// GET /api/cron/automacoes — roda todos os fluxos ativos.
//
// DE HORA EM HORA PARA CADA 15 MINUTOS — 10/09/2026
// A régua de pedido incompleto promete o primeiro toque em 15 minutos, mas
// quem decide quando ela roda é este cron. Com `0 * * * *`, "15 minutos" virava
// "no topo da próxima hora": o pedido do Wendell nasceu 21:09, a rodada tinha
// sido 21:00, e o primeiro contato possível era 22:00 — 51 minutos depois.
//
// Pior: o lead dele nem existia. É a sincronização ABAIXO que cria o lead a
// partir do pedido, e ela roda aqui dentro — então perder a rodada não atrasa
// só o envio, atrasa a existência da pessoa pro motor.
//
// Rodar a cada 15 min não multiplica mensagem: os passos são espaçados em dias,
// ninguém entra duas vezes no mesmo fluxo e o teto por rodada continua valendo.
// O que muda é a latência do primeiro toque, que é justamente o que a régua
// nova vende.
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
