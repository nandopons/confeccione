// POST /api/visualizador/[id]/gerar-mockup
// Gera (ou ajusta) um MOCKUP com IA pra um produto do pedido. A lógica toda
// mora em app/lib/mockup-pedido.ts — esta rota só valida a entrada e traduz a
// saída pro navegador. O Luigi chama a MESMA lib pelo WhatsApp: prompt é um só.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { gerarMockupDoModelo, iaParaExibicao } from '@/app/lib/mockup-pedido'

export const runtime = 'nodejs'
// 300, NÃO 60 — 12/09/2026.
//
// A conferência de visão trouxe uma operação nova pra dentro desta rota: no
// pior caso são 2 gerações + 2 conferências. As conferências custam ~2 s cada
// (medido), mas a GERAÇÃO variou de 21 s a 78 s em produção. Com 60 s de teto,
// uma única geração lenta já estoura e o cliente vê erro em vez da imagem.
//
// O 60 foi escolhido quando a rota fazia uma geração só — número de antes da
// operação que ele precisa caber. O teto de tentativas não desce por causa
// disso: quem desce é o orçamento que ficou pequeno. O plano permite 300, e os
// crons já usam.
export const maxDuration = 300

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
    // AQUI A POLÍTICA É A OPOSTA DO ENVIO AUTOMÁTICO — 12/09/2026.
    //
    // No WhatsApp e no cron, prévia que reprova na conferência não é enviada: o
    // cliente receberia pronta e confiaria. Aqui ele está OLHANDO A TELA, já
    // esperou o spinner e julga a imagem ele mesmo. Esconder depois de ~10 s de
    // espera é pior que mostrar com a ressalva do que pode não conferir.
    aoReprovar: 'entregar_com_ressalva',
  })

  // Provedor desligado/sem crédito não é erro do cliente: a tela cai no
  // placeholder e explica. Por isso 200 com `disponivel: false`.
  if (!r.ok && r.tipo === 'indisponivel') {
    return NextResponse.json({ disponivel: false, motivo: r.motivo })
  }
  // Inalcançável com `entregar_com_ressalva` (a lib entrega em vez de reprovar),
  // mas o tipo cobre os dois e "inalcançável hoje" não é garantia amanhã.
  if (!r.ok && r.tipo === 'reprovado') {
    return NextResponse.json({ disponivel: true, ia: [], divergencias: r.divergencias })
  }
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })

  // `divergencias` não vazio = a imagem vai pra tela COM ressalva. A tela é que
  // decide como mostrar; a rota só não esconde o que a conferência achou.
  return NextResponse.json({ disponivel: true, ia: iaParaExibicao(r.ia, id), divergencias: r.divergencias })
}
