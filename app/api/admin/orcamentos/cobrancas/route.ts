// app/api/admin/orcamentos/cobrancas/route.ts
// ============================================================================
// Parcelas de um orçamento avulso.
//
//   GET  ?orcamento=<uuid>   -> lista as parcelas
//   POST { acao: 'gerar_final' | 'baixa_manual', ... }
//
// `gerar_final` só funciona com o sinal já pago — enviar as duas cobranças de
// uma vez tira o sentido do sinal, e o cliente pagaria a que preferisse.
//
// `baixa_manual` existe porque cliente que faz PIX direto na chave existe.
// Exige motivo, e a parcela fica marcada como origem 'manual' — nunca vai ser
// confundida com confirmação do gateway.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { listarParcelas, gerarParcelaFinal, baixaManual } from '@/app/lib/orcamento-parcelas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function naoAutenticado(req: NextRequest): boolean {
  return !ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)
}

export async function GET(req: NextRequest) {
  if (naoAutenticado(req)) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })

  const orcamentoId = req.nextUrl.searchParams.get('orcamento')
  if (!orcamentoId) return NextResponse.json({ erro: 'Informe o orçamento' }, { status: 400 })

  return NextResponse.json({ parcelas: await listarParcelas(orcamentoId) })
}

const Corpo = z.discriminatedUnion('acao', [
  z.object({ acao: z.literal('gerar_final'), orcamentoId: z.string().uuid() }),
  z.object({
    acao: z.literal('baixa_manual'),
    orcamentoId: z.string().uuid(),
    parcela: z.number().int().min(1).max(2),
    motivo: z.string().trim().min(3).max(280),
  }),
])

export async function POST(req: NextRequest) {
  if (naoAutenticado(req)) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })

  const corpo = Corpo.safeParse(await req.json().catch(() => null))
  if (!corpo.success) {
    return NextResponse.json(
      { erro: 'Dados inválidos — a baixa manual exige o motivo' },
      { status: 400 },
    )
  }

  const r =
    corpo.data.acao === 'gerar_final'
      ? await gerarParcelaFinal(corpo.data.orcamentoId)
      : await baixaManual({
          orcamentoId: corpo.data.orcamentoId,
          parcela: corpo.data.parcela,
          motivo: corpo.data.motivo,
        })

  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: 409 })

  return NextResponse.json({
    ok: true,
    parcelas: await listarParcelas(corpo.data.orcamentoId),
  })
}
