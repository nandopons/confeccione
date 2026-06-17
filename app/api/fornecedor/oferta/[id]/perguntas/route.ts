// GET /api/fornecedor/oferta/[id]/perguntas — thread de perguntas/respostas
// de uma oferta (visão do fornecedor). Acesso público pelo uuid da oferta.
import { NextResponse } from 'next/server'
import { listarThreadOferta } from '@/app/lib/perguntas'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ erro: 'id ausente' }, { status: 400 })
  const mensagens = await listarThreadOferta(id)
  return NextResponse.json({ ok: true, mensagens })
}
