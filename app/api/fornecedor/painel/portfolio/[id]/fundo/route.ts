// POST   /api/fornecedor/painel/portfolio/[id]/fundo — isola a peça no fundo padrão.
// DELETE /api/fornecedor/painel/portfolio/[id]/fundo — volta pra foto original.
import { getFornecedorAtual } from '@/app/lib/auth-server'
import { aplicarFundoPadrao, desfazerFundoPadrao } from '@/app/lib/portfolio-fornecedor'
import { revalidatePath } from 'next/cache'

export const maxDuration = 60 // o recorte é uma chamada externa; 10s não basta

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const fornecedor = await getFornecedorAtual()
  if (!fornecedor) return Response.json({ error: 'não autenticado' }, { status: 401 })

  const { id } = await ctx.params
  const r = await aplicarFundoPadrao({ fornecedorId: fornecedor.id }, id)
  if (!r.ok) return Response.json({ error: r.motivo }, { status: 400 })
  revalidatePath('/') // o path mudou; a home em ISR apontaria pro objeto antigo
  return Response.json(r.item)
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const fornecedor = await getFornecedorAtual()
  if (!fornecedor) return Response.json({ error: 'não autenticado' }, { status: 401 })

  const { id } = await ctx.params
  const r = await desfazerFundoPadrao({ fornecedorId: fornecedor.id }, id)
  if (!r.ok) return Response.json({ error: r.motivo }, { status: 400 })
  revalidatePath('/')
  return Response.json(r.item)
}
