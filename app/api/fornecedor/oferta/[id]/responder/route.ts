// app/api/fornecedor/oferta/[id]/responder/route.ts
// POST { acao: 'aceitar'|'recusar' } — resposta do fornecedor pela página
// pública da oferta (link enviado por WhatsApp/e-mail). Acesso pelo id da
// oferta (uuid). Sem cookie: o próprio uuid é o token.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { responderOfertaFornecedor } from '@/app/lib/pedido-assistente-oferta'

export const runtime = 'nodejs'

const BodySchema = z.object({ acao: z.enum(['aceitar', 'recusar']) })
type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  let bruto: unknown
  try { bruto = await req.json() } catch { return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 }) }
  const p = BodySchema.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: 'Ação inválida' }, { status: 400 })

  const r = await responderOfertaFornecedor(id, p.data.acao)
  if (!r.ok) return NextResponse.json({ erro: r.erro, status: r.status }, { status: 409 })
  return NextResponse.json({ ok: true, status: r.status })
}
