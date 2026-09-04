import { getFornecedorAtual } from '@/app/lib/auth-server'
import { removerPortfolio } from '@/app/lib/portfolio-fornecedor'

// DELETE /api/fornecedor/painel/portfolio/[id] — remove uma foto do portfólio.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const fornecedor = await getFornecedorAtual()
  if (!fornecedor) return Response.json({ error: 'não autenticado' }, { status: 401 })

  const { id } = await ctx.params
  const ok = await removerPortfolio(fornecedor.id, id)
  if (!ok) return Response.json({ error: 'foto não encontrada' }, { status: 404 })
  return Response.json({ ok: true })
}
