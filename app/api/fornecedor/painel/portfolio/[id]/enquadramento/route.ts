// PATCH /api/fornecedor/painel/portfolio/[id]/enquadramento
// Recorta a foto de novo a partir do upload cru, com a janela que o painel
// posicionou. O corpo é { x, y, zoom } — as três âncoras antigas ainda são
// aceitas como { enquadramento } pra não quebrar aba deixada aberta no deploy.
import { getFornecedorAtual } from '@/app/lib/auth-server'
import { reenquadrar } from '@/app/lib/portfolio-fornecedor'
import {
  corteDoEnquadramento,
  corteValido,
  enquadramentoValido,
  ENQUADRAMENTOS,
} from '@/app/lib/portfolio-normalizar'
import { revalidatePath } from 'next/cache'

export const maxDuration = 30 // download + sharp + upload

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const fornecedor = await getFornecedorAtual()
  if (!fornecedor) return Response.json({ error: 'não autenticado' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const corte = ENQUADRAMENTOS.includes(body?.enquadramento)
    ? corteDoEnquadramento(enquadramentoValido(body.enquadramento))
    : corteValido(body)

  const { id } = await ctx.params
  const r = await reenquadrar({ fornecedorId: fornecedor.id }, id, corte)
  if (!r.ok) return Response.json({ error: r.motivo }, { status: 400 })

  // A foto pode estar em destaque na home; o path mudou, então a home ISR
  // precisa refazer o HTML ou continuaria apontando pro objeto apagado.
  revalidatePath('/')
  revalidatePath(`/produto/${id}`)
  return Response.json(r.item)
}
