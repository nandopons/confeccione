// POST /api/visualizador/[id]/gerar-mockup
// Gera (ou ajusta) um MOCKUP com IA pra um produto do pedido. A lógica toda
// mora em app/lib/mockup-pedido.ts — esta rota só valida a entrada e traduz a
// saída pro navegador. O Luigi chama a MESMA lib pelo WhatsApp: prompt é um só.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { gerarMockupDoModelo, iaParaExibicao } from '@/app/lib/mockup-pedido'

export const runtime = 'nodejs'
export const maxDuration = 60

const Body = z.object({
  index: z.number().int().min(0).max(199),
  instrucoes: z.string().max(2000).optional().default(''),
  regenIaIndex: z.number().int().min(0).max(50).nullable().optional(),
})

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  let bruto: unknown
  try {
    bruto = await req.json()
  } catch {
    return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 })
  }
  const p = Body.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: 'Dados inválidos' }, { status: 400 })

  const r = await gerarMockupDoModelo({
    pedidoId: id,
    index: p.data.index,
    instrucoes: p.data.instrucoes,
    regenIaIndex: p.data.regenIaIndex ?? null,
  })

  // Provedor desligado/sem crédito não é erro do cliente: a tela cai no
  // placeholder e explica. Por isso 200 com `disponivel: false`.
  if (!r.ok && r.tipo === 'indisponivel') {
    return NextResponse.json({ disponivel: false, motivo: r.motivo })
  }
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })

  return NextResponse.json({ disponivel: true, ia: iaParaExibicao(r.ia, id) })
}
