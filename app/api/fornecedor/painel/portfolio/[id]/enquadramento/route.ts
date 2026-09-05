// PATCH /api/fornecedor/painel/portfolio/[id]/enquadramento
// Recorta a foto de novo a partir do upload cru, com outra âncora (topo|centro|base).
import { getFornecedorAtual } from '@/app/lib/auth-server'
import { reenquadrar } from '@/app/lib/portfolio-fornecedor'
import { ENQUADRAMENTOS, type Enquadramento } from '@/app/lib/portfolio-normalizar'
import { revalidatePath } from 'next/cache'

export const maxDuration = 30 // download + sharp + upload

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const fornecedor = await getFornecedorAtual()
  if (!fornecedor) return Response.json({ error: 'não autenticado' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const posicao = body?.enquadramento
  if (!ENQUADRAMENTOS.includes(posicao)) {
    return Response.json({ error: 'enquadramento inválido' }, { status: 400 })
  }

  const { id } = await ctx.params
  const r = await reenquadrar({ fornecedorId: fornecedor.id }, id, posicao as Enquadramento)
  if (!r.ok) return Response.json({ error: r.motivo }, { status: 400 })

  // A foto pode estar em destaque na home; o path mudou, então a home ISR
  // precisa refazer o HTML ou continuaria apontando pro objeto apagado.
  revalidatePath('/')
  return Response.json(r.item)
}
