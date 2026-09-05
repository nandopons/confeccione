// PATCH /api/admin/vitrine/[id]/enquadramento — o ADMIN reenquadra a foto.
// ============================================================================
// Mesma operação do painel do fornecedor, mesma função (reenquadrar), só com
// `{ admin: true }` no lugar da trava de dono. A foto que entra na home é
// curada aqui: o suporte precisa conseguir arrumar um enquadramento ruim sem
// depender da confecção abrir o painel dela.
// ============================================================================

import { revalidatePath } from 'next/cache'
import { eAdminLogado } from '@/app/lib/admin-auth'
import { reenquadrar } from '@/app/lib/portfolio-fornecedor'
import {
  corteDoEnquadramento,
  corteValido,
  enquadramentoValido,
  ENQUADRAMENTOS,
} from '@/app/lib/portfolio-normalizar'
import { registrarAudit } from '@/app/lib/audit'

export const maxDuration = 30 // download + sharp + upload

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await eAdminLogado())) {
    return Response.json({ error: 'não autorizado' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const corte = ENQUADRAMENTOS.includes(body?.enquadramento)
    ? corteDoEnquadramento(enquadramentoValido(body.enquadramento))
    : corteValido(body)

  const { id } = await ctx.params
  const r = await reenquadrar({ admin: true }, id, corte)
  if (!r.ok) return Response.json({ error: r.motivo }, { status: 400 })

  await registrarAudit({
    ator: 'admin',
    acao: 'produto.reenquadrado_pelo_admin',
    entidade_tipo: 'portfolio_fornecedores',
    entidade_id: id,
    mudancas: { corte: { de: null, para: corte } },
  })

  // A foto pode estar em destaque na home; o path mudou, então a home ISR
  // precisa refazer o HTML ou continuaria apontando pro objeto apagado.
  revalidatePath('/')
  revalidatePath(`/produto/${id}`)
  return Response.json(r.item)
}
