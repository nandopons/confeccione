// app/api/admin/whatsapp/luigi-assumir/route.ts
// ============================================================================
// "Devolver pro Luigi" — o botão da conversa escalada.
//
// POST { conversaId } → limpa a marca "Luigi chamou você" e reprocessa a
// última mensagem da pessoa como se tivesse acabado de chegar.
//
// Existe porque escalar é um beco sem saída: o Luigi cala a boca e só volta a
// falar quando a PESSOA escreve de novo — mas ela já escreveu, e está
// esperando. Quando a escalada foi por erro nosso (saldo da API, timeout), a
// conversa ficava parada até alguém responder à mão.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { devolverAoLuigi } from '@/app/lib/luigi'

export const dynamic = 'force-dynamic'
// O Luigi leva de 10 a 30 s: rodada de ferramenta, resposta e as pausas entre
// as mensagens. 120 s dá folga sem deixar a requisição pendurada pra sempre.
export const maxDuration = 120

export async function POST(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  }
  const body = (await req.json().catch(() => null)) as { conversaId?: unknown } | null
  const conversaId = typeof body?.conversaId === 'string' ? body.conversaId : ''
  if (!conversaId) return NextResponse.json({ erro: 'conversaId é obrigatório' }, { status: 400 })

  try {
    const r = await devolverAoLuigi(conversaId)
    // Motivo conhecido (Luigi desligado, sem mensagem pra responder) não é erro
    // de servidor: é resposta que o inbox mostra pro Fernando como está.
    if (!r.ok) return NextResponse.json({ ok: false, erro: r.motivo ?? 'não deu pra devolver' }, { status: 409 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[luigi-assumir] falhou', { err })
    return NextResponse.json({ erro: 'Falha ao devolver a conversa pro Luigi' }, { status: 500 })
  }
}
