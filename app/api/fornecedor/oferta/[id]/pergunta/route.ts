// POST /api/fornecedor/oferta/[id]/pergunta — o FORNECEDOR faz uma pergunta
// mediada ao cliente. Acesso público pelo uuid da oferta (mesmo padrão das
// demais rotas fornecedor/oferta). Body: { texto }.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { criarPerguntaFornecedor } from '@/app/lib/perguntas'

export const runtime = 'nodejs'

const BodySchema = z.object({ texto: z.string().trim().min(1).max(1000) })
type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ erro: 'id ausente' }, { status: 400 })

  let bruto: unknown
  try { bruto = await req.json() } catch { return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 }) }
  const p = BodySchema.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: 'Mensagem inválida' }, { status: 400 })

  const r = await criarPerguntaFornecedor(id, p.data.texto)
  if (!r.ok) return NextResponse.json({ erro: r.erro ?? 'Falha ao enviar' }, { status: 409 })
  return NextResponse.json({ ok: true })
}
