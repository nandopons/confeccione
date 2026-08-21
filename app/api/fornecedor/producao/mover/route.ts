// app/api/fornecedor/producao/mover/route.ts
// ============================================================================
// O fornecedor marca em que etapa da fábrica o pedido dele está.
//
// Mesma lib do admin (app/lib/producao.ts), com uma diferença que é o ponto
// inteiro desta rota: `exigirFornecedorId` liga a checagem de dono. Sem ela,
// qualquer fornecedor logado moveria card de qualquer pedido — inclusive de
// pedidos que nem enxerga no painel.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getFornecedorAtual } from '@/app/lib/auth-server'
import { moverEtapa, ehEtapa } from '@/app/lib/producao'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Corpo = z.object({
  pedidoId: z.string().uuid(),
  etapa: z.string().refine(ehEtapa, 'Etapa desconhecida'),
  observacao: z.string().max(280).nullish(),
})

export async function POST(req: NextRequest) {
  const fornecedor = await getFornecedorAtual()
  if (!fornecedor) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  const corpo = Corpo.safeParse(await req.json().catch(() => null))
  if (!corpo.success) {
    return NextResponse.json({ erro: 'Dados inválidos' }, { status: 400 })
  }

  const r = await moverEtapa({
    pedidoId: corpo.data.pedidoId,
    etapa: corpo.data.etapa,
    autor: 'fornecedor',
    autorId: fornecedor.id,
    autorNome: fornecedor.nome,
    observacao: corpo.data.observacao ?? undefined,
    exigirFornecedorId: fornecedor.id,
  })

  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: 409 })
  return NextResponse.json({ ok: true, etapa: r.etapa })
}
