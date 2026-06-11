// POST /api/admin/marketing/disparo — disparo de oferta em massa por segmento.
// Fluxo em 2 passos: confirmar:false → prévia (total, amostra, exemplo da
// mensagem renderizada); confirmar:true → envia (cap por rodada) e registra
// cada envio em contatos_marketing. Guardado por cookie admin.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { executarDisparo, previaDisparo } from '@/app/lib/marketing-contatos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BodySchema = z.object({
  mensagem: z.string().trim().min(10, 'Mensagem muito curta').max(1000),
  filtro: z
    .object({
      fase: z.enum(['todas', 'montado', 'visualizador', 'cobranca', 'pago']).optional(),
      uf: z.string().trim().max(2).optional(),
      busca: z.string().trim().max(120).optional(),
    })
    .default({}),
  confirmar: z.boolean().default(false),
})

export async function POST(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' },
      { status: 400 }
    )
  }
  const { mensagem, filtro, confirmar } = parsed.data

  if (!confirmar) {
    return NextResponse.json({ ok: true, previa: await previaDisparo(filtro, mensagem) })
  }

  const resultado = await executarDisparo(filtro, mensagem)
  return NextResponse.json({ ok: true, resultado })
}
