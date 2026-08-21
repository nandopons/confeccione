// app/api/admin/pedidos-assistente/orcamento/route.ts
// ============================================================================
// Histórico e correção do orçamento, pelo admin.
//
//   GET ?pedido=<uuid>  -> valor corrente + todas as versões
//   PUT                 -> corrige o orçamento e grava uma versão
//
// POR QUE O ADMIN PODE MEXER NUM VALOR QUE É DO FORNECEDOR
// Porque erro acontece e hoje a única saída era "Reabrir", que zera tudo e
// devolve o pedido pro fornecedor refazer — perdendo o cliente no meio. A
// correção pede `motivo` obrigatório: quem mexe explica.
//
// TRAVA IMPORTANTE
// Pedido já pago não muda de valor por aqui. Alterar o preço depois do
// pagamento descolaria o pedido do que o Asaas efetivamente cobrou, e o
// repasse ao fornecedor sairia errado. Nesse caso é acerto fora do sistema.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { listarVersoesOrcamento, registrarVersaoOrcamento } from '@/app/lib/orcamento-versoes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function naoAutenticado(req: NextRequest): boolean {
  return !ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)
}

export async function GET(req: NextRequest) {
  if (naoAutenticado(req)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  const pedidoId = req.nextUrl.searchParams.get('pedido')
  if (!pedidoId) return NextResponse.json({ erro: 'Informe o pedido' }, { status: 400 })

  const { data: pedido } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, nome, valor_centavos, frete_centavos, repasse_centavos, orcamento_status, orcamento_definido_em, pagamento_status')
    .eq('id', pedidoId)
    .maybeSingle()

  if (!pedido) return NextResponse.json({ erro: 'Pedido não encontrado' }, { status: 404 })

  return NextResponse.json({
    pedido,
    versoes: await listarVersoesOrcamento(pedidoId),
  })
}

const CorpoEditar = z.object({
  pedidoId: z.string().uuid(),
  valorCentavos: z.number().int().positive(),
  freteCentavos: z.number().int().min(0),
  repasseCentavos: z.number().int().positive(),
  motivo: z.string().trim().min(3).max(280),
})

export async function PUT(req: NextRequest) {
  if (naoAutenticado(req)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  const corpo = CorpoEditar.safeParse(await req.json().catch(() => null))
  if (!corpo.success) {
    return NextResponse.json({ erro: 'Dados inválidos — o motivo é obrigatório' }, { status: 400 })
  }
  const { pedidoId, valorCentavos, freteCentavos, repasseCentavos, motivo } = corpo.data

  if (repasseCentavos > valorCentavos) {
    return NextResponse.json(
      { erro: 'O repasse não pode ser maior que o valor cobrado do cliente' },
      { status: 400 },
    )
  }

  const { data: pedido } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, pagamento_status')
    .eq('id', pedidoId)
    .maybeSingle()

  if (!pedido) return NextResponse.json({ erro: 'Pedido não encontrado' }, { status: 404 })
  if (pedido.pagamento_status === 'pago') {
    return NextResponse.json(
      { erro: 'Pedido já pago — o valor não pode mais ser alterado por aqui' },
      { status: 409 },
    )
  }

  const agora = new Date().toISOString()
  const { error } = await supabaseAdmin
    .from('pedidos_assistente')
    .update({
      valor_centavos: valorCentavos,
      frete_centavos: freteCentavos,
      repasse_centavos: repasseCentavos,
      orcamento_status: 'definido',
      orcamento_definido_em: agora,
      atualizado_em: agora,
    })
    .eq('id', pedidoId)

  if (error) return NextResponse.json({ erro: 'Não foi possível salvar' }, { status: 500 })

  // Mantém a oferta aceita em sincronia — é dela que sai o "a receber" do
  // fornecedor na Carteira. Sem isso o painel dele mostraria o valor velho.
  await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .update({ valor_repasse_centavos: repasseCentavos })
    .eq('pedido_id', pedidoId)
    .eq('status', 'aceita')

  await registrarVersaoOrcamento({
    pedidoId,
    valorCentavos,
    freteCentavos,
    repasseCentavos,
    autor: 'admin',
    autorNome: 'Admin',
    motivo,
  })

  return NextResponse.json({ ok: true })
}
