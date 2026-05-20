// app/api/cliente/pedido/[id]/solicitar-outro/route.ts
// ============================================================================
// POST /api/cliente/pedido/[id]/solicitar-outro
// Body: { motivo?: string } (max 500 chars)
//
// Cliente quer trocar de fornecedor neste pedido. Fluxo:
//   1. Valida que pedido pertence à conta logada
//   2. Bloqueia se status terminal (concluido/expirado_sem_resposta/manual_pausado)
//   3. Limite Free: max 2 trocas por pedido → 429
//   4. Cancela oferta atual (enviada ou aceita) se houver
//   5. Insere linha em solicitacoes_outro_fornecedor (auditoria)
//   6. Reabre pedido: status='buscando_fornecedor', fornecedor_aceito_id=null,
//      buscar_apos=now() pra cron pegar próximo ciclo
//   7. audit_log com 'pedido.solicitar_outro'
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { getContaAtual } from '@/app/lib/cliente-auth'
import { registrarAudit } from '@/app/lib/audit'

const STATUS_TERMINAL = [
  'concluido',
  'expirado_sem_resposta',
  'manual_pausado',
] as const

const LIMITE_TROCAS_FREE = 2
const MOTIVO_MAX = 500

type Pedido = {
  id: string
  conta_id: string | null
  status: string
  fornecedor_aceito_id: string | null
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const conta = await getContaAtual()
  if (!conta) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  const { id: pedidoId } = await params

  // 1. Parse body
  let body: { motivo?: unknown }
  try {
    body = (await req.json().catch(() => ({}))) as { motivo?: unknown }
  } catch {
    body = {}
  }
  const motivo =
    typeof body.motivo === 'string' && body.motivo.trim().length > 0
      ? body.motivo.trim().slice(0, MOTIVO_MAX)
      : null

  // 2. Valida pedido + conta
  const { data: pedido } = await supabaseAdmin
    .from('pedidos')
    .select('id, conta_id, status, fornecedor_aceito_id')
    .eq('id', pedidoId)
    .maybeSingle<Pedido>()

  if (!pedido) {
    return NextResponse.json({ erro: 'Pedido não encontrado' }, { status: 404 })
  }
  if (pedido.conta_id !== conta.id) {
    // Não vaza existência — 404 igual ao not found
    return NextResponse.json({ erro: 'Pedido não encontrado' }, { status: 404 })
  }

  // 3. Bloqueia status terminal
  if ((STATUS_TERMINAL as readonly string[]).includes(pedido.status)) {
    return NextResponse.json(
      {
        erro: 'Este pedido já foi encerrado e não pode mais trocar de fornecedor',
        status_atual: pedido.status,
      },
      { status: 422 },
    )
  }

  // 4. Limite de trocas
  const { count: trocas } = await supabaseAdmin
    .from('solicitacoes_outro_fornecedor')
    .select('*', { count: 'exact', head: true })
    .eq('pedido_id', pedidoId)

  if ((trocas ?? 0) >= LIMITE_TROCAS_FREE) {
    return NextResponse.json(
      {
        erro: 'Limite de trocas do plano atual atingido.',
        trocas_realizadas: trocas,
        limite: LIMITE_TROCAS_FREE,
      },
      { status: 429 },
    )
  }

  // 5. Identifica oferta atual (enviada OU aceita) — pega a mais recente
  const { data: ofertaAtual } = await supabaseAdmin
    .from('ofertas')
    .select('id, fornecedor_id, status')
    .eq('pedido_id', pedidoId)
    .in('status', ['enviada', 'aceita'])
    .order('enviada_em', { ascending: false })
    .limit(1)
    .maybeSingle()

  // 6. Cancela oferta atual (se houver)
  let ofertaCanceladaId: string | null = null
  let fornecedorCanceladoId: string | null = null
  if (ofertaAtual) {
    ofertaCanceladaId = ofertaAtual.id
    fornecedorCanceladoId = ofertaAtual.fornecedor_id
    const { error: errCancel } = await supabaseAdmin
      .from('ofertas')
      .update({
        status: 'cancelada_cliente',
        respondida_em: new Date().toISOString(),
        motivo_cancelamento: motivo,
      })
      .eq('id', ofertaAtual.id)

    if (errCancel) {
      console.error('[solicitar-outro] cancelar oferta falhou:', errCancel)
      return NextResponse.json(
        { erro: 'Erro ao processar' },
        { status: 500 },
      )
    }
  }

  // 7. Registra solicitação
  const { data: solicitacao, error: errSol } = await supabaseAdmin
    .from('solicitacoes_outro_fornecedor')
    .insert({
      pedido_id: pedidoId,
      conta_id: conta.id,
      oferta_cancelada_id: ofertaCanceladaId,
      motivo,
    })
    .select('id')
    .single()

  if (errSol || !solicitacao) {
    console.error('[solicitar-outro] insert solicitação falhou:', errSol)
    return NextResponse.json({ erro: 'Erro ao processar' }, { status: 500 })
  }

  // 8. Reabre pedido pra busca (cron pega no próximo ciclo via buscar_apos)
  const { error: errPed } = await supabaseAdmin
    .from('pedidos')
    .update({
      status: 'buscando_fornecedor',
      fornecedor_aceito_id: null,
      buscar_apos: new Date().toISOString(),
    })
    .eq('id', pedidoId)

  if (errPed) {
    console.error('[solicitar-outro] update pedido falhou:', errPed)
    return NextResponse.json({ erro: 'Erro ao processar' }, { status: 500 })
  }

  // 9. Audit
  await registrarAudit({
    ator: `cliente:${conta.id}`,
    acao: 'pedido.solicitar_outro',
    entidade_tipo: 'pedidos',
    entidade_id: pedidoId,
    mudancas: {
      status: { de: pedido.status, para: 'buscando_fornecedor' },
      fornecedor_aceito_id: {
        de: pedido.fornecedor_aceito_id,
        para: null,
      },
    },
    metadata: {
      motivo,
      oferta_cancelada_id: ofertaCanceladaId,
      fornecedor_cancelado_id: fornecedorCanceladoId,
      trocas_realizadas: (trocas ?? 0) + 1,
      user_agent: req.headers.get('user-agent') ?? null,
    },
  })

  return NextResponse.json({
    ok: true,
    solicitacao_id: (solicitacao as { id: string }).id,
    fornecedor_cancelado_id: fornecedorCanceladoId,
    oferta_cancelada_id: ofertaCanceladaId,
    trocas_restantes: LIMITE_TROCAS_FREE - ((trocas ?? 0) + 1),
  })
}
