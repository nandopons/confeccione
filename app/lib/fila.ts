// app/lib/fila.ts
// ============================================================================
// Fila de ofertas agendadas pra reenvio.
//
// Funções puras de manipulação da tabela ofertas_agendadas. NÃO disparam
// WhatsApp/email nem inserem em `ofertas` — apenas operam na fila.
//
// Uso por etapa:
//   B2: rota POST admin agenda reenvio (chama agendarReenvio)
//   B3: trigger no aceite de oferta consome próxima da fila do fornecedor
//       que aceitou, em 2 passos atômicos:
//         1. lockProximaAgendada(fornecedorId) — trava (race-safe)
//         2. dispara oferta real
//         3. vincularOferta(agendadaId, ofertaId) — vincula post-disparo
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import { temCreditoDisponivel, type Plano } from './planos'
import { dispararOfertaParaFornecedor } from './ofertas'

export type Agendada = {
  id: string
  pedido_id: string
  fornecedor_id: string
  agendada_em: string
}

type Resultado<T> =
  | ({ ok: true } & T)
  | { ok: false; erro: string }

/** Agenda um reenvio de oferta. Valida pedido + fornecedor + DUPLICADO
 *  pendente, e insere uma linha em ofertas_agendadas. NÃO dispara mensagem.
 *
 *  Duplicado: já existe agendada (pedido_id, fornecedor_id) com
 *  processada_em IS NULL. Retorna { ok: false, erro: 'já agendado' }
 *  pra caller mapear pra HTTP 409. */
export async function agendarReenvio(params: {
  pedidoId: string
  fornecedorId: string
}): Promise<Resultado<{ agendadaId: string }>> {
  if (!params.pedidoId || !params.fornecedorId) {
    return { ok: false, erro: 'pedidoId e fornecedorId obrigatórios' }
  }

  // Defesa em profundidade — FK também valida, mas check explícito dá
  // erro mais legível ("pedido não encontrado" vs erro raw de FK).
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

  // Check duplicado: já existe agendada pendente pro mesmo par?
  const { data: existente } = await supabaseAdmin
    .from('ofertas_agendadas')
    .select('id')
    .eq('pedido_id', params.pedidoId)
    .eq('fornecedor_id', params.fornecedorId)
    .is('processada_em', null)
    .maybeSingle()
  if (existente) return { ok: false, erro: 'já agendado' }

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

/** Busca a próxima oferta agendada pendente (FIFO) do fornecedor SEM TRAVAR.
 *  Leitura pura — útil pra UI preview ou COUNT, não pra disparo.
 *  Retorna null se não há nenhuma ou se houve erro de query. */
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

/** Trava (atomicamente) a próxima agendada pendente do fornecedor e
 *  retorna ela. UPDATE com WHERE processada_em IS NULL é atômico no
 *  nível da row no Postgres — só uma invocação concorrente ganha.
 *
 *  Retorna null se: não há pendente, race perdida, ou erro de query.
 *
 *  Semântica: "best-effort single dispatch". Se houver race entre
 *  SELECT e UPDATE (2 instâncias concorrentes), uma trava, outra
 *  retorna null. A segunda agendada pendente NÃO é tentada nessa
 *  chamada — fica pra próxima trigger natural (próxima oferta do
 *  fornecedor resolvendo). Sem retry interno por design.
 *
 *  IMPORTANTE pro contrato com B3:
 *  - Só chame após confirmar que o fornecedor TEM CRÉDITO disponível
 *    (temCreditoDisponivel === true). Sem-crédito NÃO consome a fila —
 *    deixe pendente pra próxima vez. Travar e não disparar = agendamento
 *    perdido pra sempre.
 *  - Após disparar a oferta real, chame vincularOferta(agendadaId, ofertaId)
 *    pra fechar o ciclo. Se vincularOferta falhar/não for chamado, a
 *    agendada fica "processada sem oferta_id" — detectável via query
 *    "agendadas processadas sem oferta_id" como sinal de falha. */
export async function lockProximaAgendada(
  fornecedorId: string
): Promise<Agendada | null> {
  if (!fornecedorId) return null

  // Pega ID da próxima candidata
  const { data: candidata } = await supabaseAdmin
    .from('ofertas_agendadas')
    .select('id, pedido_id, fornecedor_id, agendada_em')
    .eq('fornecedor_id', fornecedorId)
    .is('processada_em', null)
    .order('agendada_em', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!candidata) return null

  // Atomic check-and-set: UPDATE só passa se processada_em ainda NULL.
  // Race: se outra invocação travou entre o SELECT e o UPDATE, este
  // UPDATE não afeta nenhuma row (returns []). Retornamos null.
  const { data: locked, error } = await supabaseAdmin
    .from('ofertas_agendadas')
    .update({ processada_em: new Date().toISOString() })
    .eq('id', (candidata as Agendada).id)
    .is('processada_em', null)
    .select('id, pedido_id, fornecedor_id, agendada_em')

  if (error) {
    console.error('[fila/lockProximaAgendada] erro:', error)
    return null
  }

  const arr = (locked ?? []) as Agendada[]
  return arr.length > 0 ? arr[0] : null
}

/** Vincula a oferta real criada à agendada já travada (pós-lock).
 *  Espera-se que lockProximaAgendada tenha sido chamado antes.
 *
 *  Dívida: não checa affected_rows pra distinguir "row não existia" de
 *  "row já tinha oferta_id". Caller acabou de receber agendadaId via
 *  lock, então é improvável a row sumir entre lock e vincular — baixa
 *  prioridade. */
export async function vincularOferta(params: {
  agendadaId: string
  ofertaId: string
}): Promise<Resultado<{}>> {
  if (!params.agendadaId || !params.ofertaId) {
    return { ok: false, erro: 'agendadaId e ofertaId obrigatórios' }
  }

  const { error } = await supabaseAdmin
    .from('ofertas_agendadas')
    .update({ oferta_id: params.ofertaId })
    .eq('id', params.agendadaId)
    .is('oferta_id', null) // idempotência: só atualiza se ainda não vinculada

  if (error) {
    console.error('[fila/vincularOferta] erro:', error)
    return { ok: false, erro: error.message }
  }

  return { ok: true }
}

/** Acorda a fila de reenvios pra um fornecedor (B3 — composição dos 4 passos).
 *
 *  Fluxo:
 *    1. Checa crédito do fornecedor (sem crédito → return early; agendada
 *       continua pendente — fila persistente)
 *    2. Trava próxima agendada via lockProximaAgendada (atomic check-and-set)
 *    3. Dispara oferta real via dispararOfertaParaFornecedor
 *    4. Vincula oferta criada à agendada (fecha ciclo)
 *
 *  Failure-soft: cada passo trata seu erro e loga. Caller deve envolver
 *  em try/catch também (defesa em profundidade — esta função NÃO deve
 *  quebrar o fluxo de aceite/recusa que a chamou).
 *
 *  Único disparo por chamada (FIFO). Coerente com "best-effort single
 *  dispatch" do lockProximaAgendada. */
export async function processarProximaAgendadaSeHouver(
  fornecedorId: string
): Promise<void> {
  if (!fornecedorId) return

  // 1. Checa crédito ANTES de travar
  const { data: forn } = await supabaseAdmin
    .from('leads_fornecedores')
    .select('id, plano, plano_expira_em, creditos_extras')
    .eq('id', fornecedorId)
    .maybeSingle()

  if (!forn) {
    console.error('[fila/processar] fornecedor não encontrado:', fornecedorId)
    return
  }

  const credito = await temCreditoDisponivel(
    forn as {
      id: string
      plano: Plano
      plano_expira_em: string | null
      creditos_extras: number
    }
  )
  if (!credito.tem_credito) {
    // Não consome agendamento — deixa pendente pra próxima vez
    return
  }

  // 2. Trava próxima agendada (atomic)
  const agendada = await lockProximaAgendada(fornecedorId)
  if (!agendada) return

  // 3. Dispara oferta real
  const resultado = await dispararOfertaParaFornecedor(
    agendada.pedido_id,
    agendada.fornecedor_id
  )
  if (!resultado.ok) {
    // Agendada já travada (processada_em != null) mas oferta_id NULL.
    // Sinal detectável via query "agendadas processadas sem oferta_id".
    console.error(
      `[fila/processar] disparo falhou pra agendada ${agendada.id}:`,
      resultado.erro
    )
    return
  }

  // 4. Vincula oferta criada (fecha ciclo)
  await vincularOferta({
    agendadaId: agendada.id,
    ofertaId: resultado.ofertaId,
  })
}
