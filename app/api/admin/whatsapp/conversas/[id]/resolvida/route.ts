// app/api/admin/whatsapp/conversas/[id]/resolvida/route.ts
// ============================================================================
// "Já resolvi" — baixa a marca "Luigi chamou você" sem responder pelo inbox.
//
// POR QUE ISTO EXISTE — 10/09/2026
// A marca de escalada só some quando alguém responde PELO INBOX
// (humanoRespondeu, em luigi.ts). Mas o Fernando resolve boa parte das
// conversas pelo WhatsApp pessoal dele, e nesses casos o sistema nunca fica
// sabendo: a marca fica acesa pra sempre.
//
// O custo não é estético. Em 10/09 havia 8 conversas marcadas e 7 já estavam
// encerradas — a última fala da pessoa era "Ok", "Obrigado", figurinha. A
// oitava era a Rafaella, que tinha dito "já paguei e não foi esse" e estava
// há 43 horas sem resposta. Ela desapareceu no meio das outras sete.
//
// Alarme que toca sempre deixa de ser alarme: a fila só serve pra decidir o
// que fazer agora se o que está nela realmente precisa de alguém.
//
// NÃO ESCREVE PRA NINGUÉM e não mexe no modo do Luigi. Só apaga a marca. Se a
// pessoa mandar outra mensagem e o Luigi precisar de gente de novo, ele escala
// outra vez — nada aqui é definitivo.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { humanoRespondeu } from '@/app/lib/luigi'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  }
  const { id } = await ctx.params

  const { data: conversa } = await supabaseAdmin
    .from('wa_conversas')
    .select('id')
    .eq('id', id)
    .maybeSingle<{ id: string }>()
  if (!conversa) return NextResponse.json({ erro: 'Conversa não encontrada' }, { status: 404 })

  // Reusa o caminho que já existe pra "gente assumiu": limpa a marca e descarta
  // as sugestões pendentes, que também ficariam órfãs.
  await humanoRespondeu(id)

  return NextResponse.json({ ok: true })
}
