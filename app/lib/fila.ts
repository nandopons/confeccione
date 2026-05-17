// app/lib/fila.ts
// ============================================================================
// Fila de ofertas agendadas pra reenvio.
//
// Funções puras de manipulação da tabela ofertas_agendadas. NÃO disparam
// WhatsApp/email nem inserem em `ofertas` — apenas operam na fila.
//
// Etapas posteriores consomem essas funções:
//   B2: rota POST admin agenda reenvio (chama agendarReenvio)
//   B3: trigger no aceite consome próxima da fila do fornecedor que aceitou
//       (chama proximaAgendadaDeFornecedor + marcarAgendadaProcessada após
//       gerar a oferta real)
//
// Idempotência: marcarAgendadaProcessada usa `processada_em IS NULL` no
// WHERE pra não sobrescrever timestamp se chamada 2x.
// ============================================================================

import { supabaseAdmin } from './supabase-server'

export type Agendada = {
  id: string
  pedido_id: string
  fornecedor_id: string
  agendada_em: string
}

type Resultado<T> =
  | ({ ok: true } & T)
  | { ok: false; erro: string }

/** Agenda um reenvio de oferta. Valida que pedido e fornecedor existem
 *  e insere uma linha em ofertas_agendadas. NÃO dispara mensagem. */
export async function agendarReenvio(params: {
  pedidoId: string
  fornecedorId: string
}): Promise<Resultado<{ agendadaId: string }>> {
  if (!params.pedidoId || !params.fornecedorId) {
    return { ok: false, erro: 'pedidoId e fornecedorId obrigatórios' }
  }

  // Defesa em profundidade — FK também valida, mas check explícito dá
  // erro mais legível pro caller ("pedido não encontrado" vs erro raw
  // de violação de FK).
  const { data: pedido } = await supabaseAdmin
    .from('pedidos')
    .select('id')
    .eq('id', params.pedidoId)
    .maybeSingle()
  if (!pedido) return { ok: false, erro: 'pedido não encontrado' }

  const { data: fornecedor } = await supabaseAdmin
    .from('leads_fornecedores')
    .select('id')
    .eq('id', params.fornecedorId)
    .maybeSingle()
  if (!fornecedor) return { ok: false, erro: 'fornecedor não encontrado' }

  const { data: agendada, error: insErr } = await supabaseAdmin
    .from('ofertas_agendadas')
    .insert({
      pedido_id: params.pedidoId,
      fornecedor_id: params.fornecedorId,
      tipo_origem: 'reenvio_admin',
    })
    .select('id')
    .single()

  if (insErr || !agendada) {
    console.error('[fila/agendarReenvio] insert falhou:', insErr)
    return { ok: false, erro: insErr?.message ?? 'erro ao inserir' }
  }

  return { ok: true, agendadaId: (agendada as { id: string }).id }
}

/** Busca a próxima oferta agendada pendente (FIFO) do fornecedor.
 *  Retorna null se não há nenhuma OU se houve erro de query.
 *  Erros vão pro console — caller decide. */
export async function proximaAgendadaDeFornecedor(
  fornecedorId: string
): Promise<Agendada | null> {
  if (!fornecedorId) return null

  const { data, error } = await supabaseAdmin
    .from('ofertas_agendadas')
    .select('id, pedido_id, fornecedor_id, agendada_em')
    .eq('fornecedor_id', fornecedorId)
    .is('processada_em', null)
    .order('agendada_em', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[fila/proximaAgendadaDeFornecedor] erro:', error)
    return null
  }

  return (data as Agendada | null) ?? null
}

/** Marca uma agendada como processada e vincula à oferta real criada.
 *  Idempotente: usa `processada_em IS NULL` no WHERE pra evitar
 *  sobrescrever timestamp se chamada 2x pra mesma agendadaId. */
export async function marcarAgendadaProcessada(params: {
  agendadaId: string
  ofertaId: string
}): Promise<Resultado<{}>> {
  if (!params.agendadaId || !params.ofertaId) {
    return { ok: false, erro: 'agendadaId e ofertaId obrigatórios' }
  }

  const { error } = await supabaseAdmin
    .from('ofertas_agendadas')
    .update({
      processada_em: new Date().toISOString(),
      oferta_id: params.ofertaId,
    })
    .eq('id', params.agendadaId)
    .is('processada_em', null)

  if (error) {
    console.error('[fila/marcarAgendadaProcessada] erro:', error)
    return { ok: false, erro: error.message }
  }

  return { ok: true }
}
