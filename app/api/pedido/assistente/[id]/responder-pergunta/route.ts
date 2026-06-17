// POST /api/pedido/assistente/[id]/responder-pergunta — o CLIENTE responde a
// uma thread no visualizador. Body: { ofertaId, texto }. Acesso pelo uuid do
// pedido. A oferta precisa pertencer a este pedido.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { responderPerguntaCliente } from '@/app/lib/perguntas'

export const runtime = 'nodejs'

const BodySchema = z.object({
  ofertaId: z.string().trim().min(1),
  texto: z.string().trim().min(1).max(1000),
})
type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ erro: 'id ausente' }, { status: 400 })

  let bruto: unknown
  try { bruto = await req.json() } catch { return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 }) }
  const p = BodySchema.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: 'Dados inválidos' }, { status: 400 })

  const r = await responderPerguntaCliente(id, p.data.ofertaId, p.data.texto)
  if (!r.ok) return NextResponse.json({ erro: r.erro ?? 'Falha ao responder' }, { status: 409 })
  return NextResponse.json({ ok: true })
}
