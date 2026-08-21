// app/api/admin/producao/route.ts
// ============================================================================
// Quadro de produção do admin.
//
//   GET                  -> quadro inteiro (todos os pedidos pagos e abertos)
//   GET ?pedido=<uuid>   -> linha do tempo daquele pedido
//   POST                 -> move um card de etapa
//
// A regra toda mora em app/lib/producao.ts — aqui só entra autenticação e
// tradução HTTP. O painel do fornecedor chama a MESMA lib por outra rota, com
// o filtro de dono ligado.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { carregarQuadro, moverEtapa, timelineProducao, ETAPAS, ehEtapa } from '@/app/lib/producao'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function naoAutenticado(req: NextRequest): boolean {
  return !ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)
}

export async function GET(req: NextRequest) {
  if (naoAutenticado(req)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  const pedido = req.nextUrl.searchParams.get('pedido')
  if (pedido) {
    return NextResponse.json({ eventos: await timelineProducao(pedido) })
  }

  return NextResponse.json({ etapas: ETAPAS, cards: await carregarQuadro() })
}

const CorpoMover = z.object({
  pedidoId: z.string().uuid(),
  etapa: z.string().refine(ehEtapa, 'Etapa desconhecida'),
  observacao: z.string().max(280).nullish(),
})

export async function POST(req: NextRequest) {
  if (naoAutenticado(req)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  const corpo = CorpoMover.safeParse(await req.json().catch(() => null))
  if (!corpo.success) {
    return NextResponse.json({ erro: 'Dados inválidos' }, { status: 400 })
  }

  const r = await moverEtapa({
    pedidoId: corpo.data.pedidoId,
    etapa: corpo.data.etapa,
    autor: 'admin',
    autorNome: 'Admin',
    observacao: corpo.data.observacao ?? undefined,
  })

  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: 409 })
  return NextResponse.json({ ok: true, etapa: r.etapa })
}
