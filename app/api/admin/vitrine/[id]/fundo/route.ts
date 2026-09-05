// POST   /api/admin/vitrine/[id]/fundo — o ADMIN isola a peça no fundo padrão.
// DELETE /api/admin/vitrine/[id]/fundo — volta pra foto original.
// ============================================================================
// Mesmas funções do painel do fornecedor, com `{ admin: true }` no lugar da
// trava de dono. O recorte é a diferença entre uma foto de celular e uma foto
// que pode abrir a home — e quem decide o que entra na home é o suporte.
//
// A foto original nunca é apagada (`path_original`), então o DELETE aqui
// desfaz de verdade: o admin não consegue destruir o que a confecção mandou.
// ============================================================================

import { revalidatePath } from 'next/cache'
import { eAdminLogado } from '@/app/lib/admin-auth'
import { aplicarFundoPadrao, desfazerFundoPadrao } from '@/app/lib/portfolio-fornecedor'
import { registrarAudit } from '@/app/lib/audit'

export const maxDuration = 60 // o recorte é uma chamada externa; 10s não basta

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await eAdminLogado())) {
    return Response.json({ error: 'não autorizado' }, { status: 401 })
  }

  const { id } = await ctx.params
  const r = await aplicarFundoPadrao({ admin: true }, id)
  if (!r.ok) return Response.json({ error: r.motivo }, { status: 400 })

  await registrarAudit({
    ator: 'admin',
    acao: 'produto.fundo_removido_pelo_admin',
    entidade_tipo: 'portfolio_fornecedores',
    entidade_id: id,
    mudancas: null,
  })

  revalidatePath('/') // o path mudou; a home em ISR apontaria pro objeto antigo
  revalidatePath(`/produto/${id}`)
  return Response.json(r.item)
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await eAdminLogado())) {
    return Response.json({ error: 'não autorizado' }, { status: 401 })
  }

  const { id } = await ctx.params
  const r = await desfazerFundoPadrao({ admin: true }, id)
  if (!r.ok) return Response.json({ error: r.motivo }, { status: 400 })

  await registrarAudit({
    ator: 'admin',
    acao: 'produto.fundo_restaurado_pelo_admin',
    entidade_tipo: 'portfolio_fornecedores',
    entidade_id: id,
    mudancas: null,
  })

  revalidatePath('/')
  revalidatePath(`/produto/${id}`)
  return Response.json(r.item)
}
