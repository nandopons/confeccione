import { getFornecedorAtual } from '@/app/lib/auth-server'
import { removerPortfolio, salvarFichaProduto } from '@/app/lib/portfolio-fornecedor'
import { revalidatePath } from 'next/cache'

// PATCH /api/fornecedor/painel/portfolio/[id] — salva a ficha do produto.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const fornecedor = await getFornecedorAtual()
  if (!fornecedor) return Response.json({ error: 'não autenticado' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'dados inválidos' }, { status: 400 })
  }

  const { id } = await ctx.params
  const item = await salvarFichaProduto(fornecedor.id, id, body)
  if (!item) return Response.json({ error: 'foto não encontrada' }, { status: 404 })

  // O nome do produto é a legenda do card na home e o título da página pública.
  revalidatePath('/')
  revalidatePath(`/produto/${id}`)
  return Response.json(item)
}

// DELETE /api/fornecedor/painel/portfolio/[id] — remove uma foto do portfólio.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const fornecedor = await getFornecedorAtual()
  if (!fornecedor) return Response.json({ error: 'não autenticado' }, { status: 401 })

  const { id } = await ctx.params
  const ok = await removerPortfolio(fornecedor.id, id)
  if (!ok) return Response.json({ error: 'foto não encontrada' }, { status: 404 })
  return Response.json({ ok: true })
}
