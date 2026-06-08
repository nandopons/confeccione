// app/api/admin/precos/pesquisar/route.ts
// POST — pesquisa de mercado por IA (admin). Não salva — devolve a curva pro
// admin revisar e ajustar.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { pesquisarCurvaPreco } from '@/app/lib/pesquisa-preco'

export const runtime = 'nodejs'

const BodySchema = z.object({
  modelo: z.string().min(1),
  material: z.string().nullable().optional(),
  estampado: z.boolean().default(false),
  faixasQtdMin: z.array(z.number().int().positive()).optional(),
})

export async function POST(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  let bruto: unknown
  try { bruto = await req.json() } catch { return NextResponse.json({ erro: 'Body inválido' }, { status: 400 }) }
  const p = BodySchema.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: 'Informe ao menos o modelo.' }, { status: 400 })

  const r = await pesquisarCurvaPreco({
    modelo: p.data.modelo,
    material: p.data.material ?? null,
    estampado: p.data.estampado,
    breakpoints: p.data.faixasQtdMin,
  })
  if (!r) return NextResponse.json({ erro: 'A IA não conseguiu estimar agora. Tente de novo.' }, { status: 502 })

  return NextResponse.json({ ok: true, faixas: r.faixas, observacao: r.observacao })
}
