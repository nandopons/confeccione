// app/api/admin/pedidos/reabrir/route.ts
// ============================================================================
// POST /api/admin/pedidos/reabrir
//
// Body JSON: { pedido_id: string }
//
// Reabre a busca de um pedido que SAIU dela (em_negociacao/concluido): remove o
// vínculo do fornecedor aceito e devolve o pedido pra fila de busca. Reativa o
// registro de órfão fechado (resolvido/descartado → aberto) se houver — senão o
// detectarOrfaos recria um órfão fresco depois.
//
// Ordem dos UPDATEs: pedido PRIMEIRO, órfão DEPOIS. Falha parcial é auto-curável:
//   - se (2) falhar após (1): pedido fica buscando (aparece em "Precisa de
//     atenção" pela via stuck; não some, não duplica) e o detectarOrfaos recria
//     o órfão. Órfão fechado pendurado é filtrado das abas (pedido_status).
//   - se (1) falhar: nada muda; reporta erro.
//
// Defesa em profundidade: middleware bloqueia /api/admin/* sem cookie válido;
// revalidamos via ehTokenAdminValido().
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { registrarAudit } from '@/app/lib/audit'

// Estados de pedido que PODEM ser reabertos (saíram da busca).
const STATUS_REABRIVEL: readonly string[] = ['em_negociacao', 'concluido']

export async function POST(req: NextRequest) {
  const cookieValue = req.cookies.get(COOKIE_ADMIN)?.value
  if (!ehTokenAdminValido(cookieValue)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  let body: { pedido_id?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ erro: 'Body inválido' }, { status: 400 })
  }

  const pedidoId = body.pedido_id
  if (typeof pedidoId !== 'string' || pedidoId.length === 0) {
    return NextResponse.json(
      { erro: 'pedido_id ausente ou inválido' },
      { status: 400 }
    )
  }

  // Valida que o pedido existe + lê estado atual (pra audit + guard).
  const { data: pedidoRaw, error: selErr } = await supabaseAdmin
    .from('pedidos')
    .select('id, status, fornecedor_aceito_id')
    .eq('id', pedidoId)
    .maybeSingle()

  if (selErr) {
    console.error('[admin/pedidos/reabrir] erro ao ler pedido:', selErr)
    return NextResponse.json({ erro: 'Erro ao processar' }, { status: 500 })
  }
  if (!pedidoRaw) {
    return NextResponse.json({ erro: 'Pedido não encontrado' }, { status: 404 })
  }

  const pedido = pedidoRaw as {
    id: string
    status: string
    fornecedor_aceito_id: string | null
  }

  // Só reabre quem saiu da busca. Quem já está buscando não tem o que reabrir.
  if (!STATUS_REABRIVEL.includes(pedido.status)) {
    return NextResponse.json(
      { erro: 'Pedido não está em estado reabrível', status_atual: pedido.status },
      { status: 409 }
    )
  }

  // (1) Pedido PRIMEIRO: volta pra busca, remove vínculo do fornecedor.
  const { error: pedErr } = await supabaseAdmin
    .from('pedidos')
    .update({ status: 'buscando_fornecedor', fornecedor_aceito_id: null })
    .eq('id', pedidoId)

  if (pedErr) {
    console.error('[admin/pedidos/reabrir] erro ao atualizar pedido:', pedErr)
    return NextResponse.json({ erro: 'Erro ao reabrir pedido' }, { status: 500 })
  }

  // (2) Órfão DEPOIS: reativa o registro fechado, se houver. Failure-soft — o
  // pedido já está buscando; falha aqui é auto-curável (stuck + detectarOrfaos).
  const { error: orfErr } = await supabaseAdmin
    .from('pedidos_orfaos')
    .update({ status_orfao: 'aberto' })
    .eq('pedido_id', pedidoId)
    .in('status_orfao', ['resolvido', 'descartado'])

  if (orfErr) {
    console.error(
      '[admin/pedidos/reabrir] update pedidos_orfaos falhou (auto-curável):',
      orfErr
    )
  }

  // Audit — reabrir muta o pedido (status + vínculo), mesma natureza do
  // pedido.solicitar_outro do cliente. Segue o padrão de app/lib/audit.ts.
  await registrarAudit({
    ator: 'admin',
    acao: 'pedido.reabrir_busca',
    entidade_tipo: 'pedidos',
    entidade_id: pedidoId,
    mudancas: {
      status: { de: pedido.status, para: 'buscando_fornecedor' },
      fornecedor_aceito_id: { de: pedido.fornecedor_aceito_id, para: null },
    },
  })

  return NextResponse.json({ ok: true })
}
