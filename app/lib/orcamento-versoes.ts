// app/lib/orcamento-versoes.ts
// ============================================================================
// Histórico do orçamento de um pedido.
//
// O PROBLEMA QUE ISTO RESOLVE
// Até 20/08/2026 cada reenvio do fornecedor dava UPDATE em valor_centavos,
// repasse_centavos e orcamento_definido_em no próprio pedido. O valor anterior
// simplesmente desaparecia — não dava para responder "quanto tinha sido orçado
// antes" nem "quem mudou". Daqui pra frente cada gravação deixa uma linha em
// orcamento_versoes.
//
// O QUE NÃO DÁ PRA FAZER
// Recuperar o que já foi sobrescrito. O histórico nasce vazio e vai enchendo.
//
// BEST-EFFORT DE PROPÓSITO
// Registrar versão nunca pode derrubar o salvamento do orçamento — o dinheiro
// é o UPDATE no pedido; isto é o rastro. Se falhar, loga e segue.
// ============================================================================

import { supabaseAdmin } from './supabase-server'

export type VersaoOrcamento = {
  id: string
  versao: number
  valorCentavos: number | null
  freteCentavos: number | null
  repasseCentavos: number | null
  autor: 'fornecedor' | 'admin'
  autorNome: string | null
  motivo: string | null
  criadoEm: string
}

/**
 * Grava uma versão. Chamada DEPOIS do UPDATE no pedido, nos dois caminhos que
 * escrevem orçamento (web do fornecedor e app mobile) e na edição pelo admin.
 *
 * A numeração é calculada aqui e protegida pela unique (pedido_id, versao): se
 * dois salvamentos correrem juntos, um perde a corrida e a versão dele não
 * entra — melhor perder um registro de auditoria do que gravar duas versões 3
 * e nunca mais saber a ordem.
 */
export async function registrarVersaoOrcamento(params: {
  pedidoId: string
  valorCentavos: number | null
  freteCentavos: number | null
  repasseCentavos: number | null
  linhas?: unknown
  orcamentoItens?: unknown
  freteMe?: unknown
  autor: 'fornecedor' | 'admin'
  autorId?: string | null
  autorNome?: string | null
  motivo?: string | null
}): Promise<void> {
  try {
    const { data: ultima } = await supabaseAdmin
      .from('orcamento_versoes')
      .select('versao')
      .eq('pedido_id', params.pedidoId)
      .order('versao', { ascending: false })
      .limit(1)
      .maybeSingle()

    const versao = ((ultima?.versao as number | undefined) ?? 0) + 1

    await supabaseAdmin.from('orcamento_versoes').insert({
      pedido_id: params.pedidoId,
      versao,
      valor_centavos: params.valorCentavos,
      frete_centavos: params.freteCentavos,
      repasse_centavos: params.repasseCentavos,
      linhas: params.linhas ?? null,
      orcamento_itens: params.orcamentoItens ?? null,
      frete_me: params.freteMe ?? null,
      autor: params.autor,
      autor_id: params.autorId ?? null,
      autor_nome: params.autorNome ?? null,
      motivo: params.motivo ?? null,
    })
  } catch (e) {
    console.error('[orcamento-versoes] não foi possível registrar a versão', e)
  }
}

// ─── Correção do orçamento ──────────────────────────────────────────────────

export type ResultadoCorrecaoOrcamento =
  | { ok: true; valorCentavos: number; freteCentavos: number; repasseCentavos: number }
  | { ok: false; erro: string; codigo: 'repasse_maior' | 'nao_encontrado' | 'pago' | 'falha_gravacao' }

/**
 * Corrige o orçamento de um pedido e deixa o rastro (versão + sincronia da
 * oferta aceita). É a ÚNICA implementação da regra: a rota do admin e o
 * servidor MCP chamam esta função, pra não existir uma segunda cópia da trava
 * de "pedido pago não muda de valor" que pudesse divergir com o tempo.
 *
 * Não recebe Request nem devolve Response de propósito — quem chama traduz o
 * resultado pro seu transporte (HTTP no admin, texto/erro no MCP).
 *
 * Efeito no funil (D-8): ao gravar orcamento_status='definido' o pedido passa
 * de em_negociacao/orcamento_atrasado para aguardando_pagamento sozinho, porque
 * a etapa é derivada do fato. Não existe (nem deve existir) "mover etapa".
 */
export async function corrigirOrcamento(params: {
  pedidoId: string
  valorCentavos: number
  freteCentavos: number
  repasseCentavos: number
  motivo: string
  autorNome?: string | null
}): Promise<ResultadoCorrecaoOrcamento> {
  const { pedidoId, valorCentavos, freteCentavos, repasseCentavos, motivo } = params

  if (repasseCentavos > valorCentavos) {
    return { ok: false, codigo: 'repasse_maior', erro: 'O repasse não pode ser maior que o valor cobrado do cliente' }
  }

  const { data: pedido } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, pagamento_status')
    .eq('id', pedidoId)
    .maybeSingle()

  if (!pedido) return { ok: false, codigo: 'nao_encontrado', erro: 'Pedido não encontrado' }
  if (pedido.pagamento_status === 'pago') {
    return {
      ok: false,
      codigo: 'pago',
      erro: 'Pedido já pago — o valor não pode mais ser alterado por aqui (o Asaas já cobrou; acerto é fora do sistema)',
    }
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

  if (error) return { ok: false, codigo: 'falha_gravacao', erro: 'Não foi possível salvar' }

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
    autorNome: params.autorNome ?? 'Admin',
    motivo,
  })

  return { ok: true, valorCentavos, freteCentavos, repasseCentavos }
}

export async function listarVersoesOrcamento(pedidoId: string): Promise<VersaoOrcamento[]> {
  const { data } = await supabaseAdmin
    .from('orcamento_versoes')
    .select('id, versao, valor_centavos, frete_centavos, repasse_centavos, autor, autor_nome, motivo, criado_em')
    .eq('pedido_id', pedidoId)
    .order('versao', { ascending: false })

  return ((data ?? []) as unknown as {
    id: string
    versao: number
    valor_centavos: number | null
    frete_centavos: number | null
    repasse_centavos: number | null
    autor: 'fornecedor' | 'admin'
    autor_nome: string | null
    motivo: string | null
    criado_em: string
  }[]).map((v) => ({
    id: v.id,
    versao: v.versao,
    valorCentavos: v.valor_centavos,
    freteCentavos: v.frete_centavos,
    repasseCentavos: v.repasse_centavos,
    autor: v.autor,
    autorNome: v.autor_nome,
    motivo: v.motivo,
    criadoEm: v.criado_em,
  }))
}
