// app/lib/planos.ts
// ============================================================================
// Central de regras de planos: limites, preços, cooldowns, etc.
// Toda lógica relacionada a plano/cota passa por aqui.
// ============================================================================

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export type Plano = 'free' | 'starter' | 'pro'

// ============================================================================
// CONFIGURAÇÃO DOS PLANOS
// ============================================================================

export const PLANOS_CONFIG: Record<
  Plano,
  {
    nome: string
    preco_mes: number
    leads_inclusos: number
    preco_lead_extra: number
  }
> = {
  free: {
    nome: 'Free',
    preco_mes: 0,
    leads_inclusos: 3,
    preco_lead_extra: 15,
  },
  starter: {
    nome: 'Starter',
    preco_mes: 89,
    leads_inclusos: 10,
    preco_lead_extra: 12,
  },
  pro: {
    nome: 'Pro',
    preco_mes: 199,
    leads_inclusos: 30,
    preco_lead_extra: 10,
  },
}

// Pacotes de leads extras avulsos (cliente escolhe na hora do upgrade)
export const PACOTES_LEADS_EXTRAS = [
  { quantidade: 5, label: '5 pedidos' },
  { quantidade: 10, label: '10 pedidos' },
  { quantidade: 25, label: '25 pedidos' },
] as const

// Trial automático ao se cadastrar
export const TRIAL_DURACAO_DIAS = 90

// Janela pra fornecedor sem crédito decidir comprar pacote/upgrade
export const JANELA_SEM_CREDITO_MS = 3 * 60 * 60 * 1000 // 3 horas

// Anti-spam: máximo de gatilhos de upgrade por dia por fornecedor
export const MAX_GATILHOS_UPGRADE_POR_DIA = 1

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Retorna o plano EFETIVO de um fornecedor: se o trial expirou,
 * retorna 'free' independente do que está no banco. Se o cron de expiração
 * não rodou ainda, isso protege a regra de cota em tempo real.
 */
export function planoEfetivo(fornecedor: {
  plano: Plano
  plano_expira_em: string | null
}): Plano {
  if (!fornecedor.plano_expira_em) return fornecedor.plano
  const expira = new Date(fornecedor.plano_expira_em).getTime()
  if (expira < Date.now()) return 'free'
  return fornecedor.plano
}

/**
 * Conta ofertas NORMAIS (não-sem-credito) que o fornecedor ACEITOU
 * na janela corrente. Apenas status='aceita' consome cota — leads recebidos
 * mas recusados/expirados não contam (decisão revisada em 2026-05-09).
 *
 * Janela: do aniversário do plano (plano_ativado_em) até NOW.
 * Failure-soft em plano_ativado_em NULL: fallback pro dia 1 do mês
 * calendário UTC (modelo pré-Sprint 3). Hoje todos os 13 fornecedores têm
 * plano_ativado_em populado; o fallback existe como defesa.
 */
export async function contarOfertasMesAtual(fornecedor: {
  id: string
  plano_ativado_em: string | null
}): Promise<number> {
  const inicioJanela = fornecedor.plano_ativado_em
    ? inicioJanelaCotaAtual(fornecedor.plano_ativado_em)
    : inicioMesCalendarioUtc()

  const { count } = await supabase
    .from('ofertas')
    .select('*', { count: 'exact', head: true })
    .eq('fornecedor_id', fornecedor.id)
    .eq('tipo_oferta', 'normal')
    .eq('status', 'aceita')
    .gte('enviada_em', inicioJanela.toISOString())

  return count ?? 0
}

/**
 * Verifica se o fornecedor ainda tem crédito pra receber oferta normal.
 * Considera lotes de avulsos ativos + cota mensal do plano.
 *
 * O parâmetro `creditos_extras` permanece no shape pra compat com callers
 * que ainda passam a coluna deprecated, mas o cálculo IGNORA o valor e
 * lê da tabela creditos_avulsos via listarLotesAtivos. Drop da coluna
 * fica como TODO futuro.
 */
export async function temCreditoDisponivel(fornecedor: {
  id: string
  plano: Plano
  plano_expira_em: string | null
  plano_ativado_em: string | null
  creditos_extras: number
}): Promise<{
  tem_credito: boolean
  usados_no_mes: number
  limite_mes: number
  creditos_extras: number
}> {
  const planoAtual = planoEfetivo(fornecedor)
  const config = PLANOS_CONFIG[planoAtual] ?? PLANOS_CONFIG['free']
  const [usados, lotes] = await Promise.all([
    contarOfertasMesAtual({
      id: fornecedor.id,
      plano_ativado_em: fornecedor.plano_ativado_em,
    }),
    listarLotesAtivos(fornecedor.id),
  ])

  const totalAvulsos = lotes.reduce((s, l) => s + l.quantidade_disponivel, 0)

  const tem_credito = usados < config.leads_inclusos || totalAvulsos > 0

  return {
    tem_credito,
    usados_no_mes: usados,
    limite_mes: config.leads_inclusos,
    creditos_extras: totalAvulsos,
  }
}

/**
 * Verifica se o fornecedor pode receber um gatilho de upgrade hoje
 * (anti-spam: máximo 1 por dia).
 */
export async function podeReceberGatilhoUpgrade(
  fornecedorId: string
): Promise<boolean> {
  const inicioHoje = new Date()
  inicioHoje.setHours(0, 0, 0, 0)

  const { count } = await supabase
    .from('gatilhos_upgrade')
    .select('*', { count: 'exact', head: true })
    .eq('fornecedor_id', fornecedorId)
    .gte('enviado_em', inicioHoje.toISOString())

  return (count ?? 0) < MAX_GATILHOS_UPGRADE_POR_DIA
}

/**
 * Registra que um gatilho de upgrade foi enviado pra esse fornecedor.
 */
export async function registrarGatilhoUpgrade(params: {
  fornecedorId: string
  pedidoId: string
  ofertaId: string
}): Promise<void> {
  await supabase.from('gatilhos_upgrade').insert({
    fornecedor_id: params.fornecedorId,
    pedido_id: params.pedidoId,
    oferta_id: params.ofertaId,
  })
}

// ============================================================================
// LOTES DE CRÉDITOS AVULSOS (creditos_avulsos)
// ============================================================================

export type LoteAvulso = {
  id: string
  quantidade_inicial: number
  quantidade_disponivel: number
  criado_em: string
  expira_em: string
}

/**
 * Lista lotes ativos do fornecedor (FIFO — mais antigo primeiro).
 * Ativo = disponível > 0 AND não esgotado AND não expirado AND expira_em > NOW.
 */
export async function listarLotesAtivos(
  fornecedorId: string
): Promise<LoteAvulso[]> {
  const { data, error } = await supabase
    .from('creditos_avulsos')
    .select('id, quantidade_inicial, quantidade_disponivel, criado_em, expira_em')
    .eq('fornecedor_id', fornecedorId)
    .gt('quantidade_disponivel', 0)
    .gt('expira_em', new Date().toISOString())
    .is('esgotado_em', null)
    .is('expirado_em', null)
    .order('criado_em', { ascending: true })

  if (error) {
    console.error('[planos/listarLotesAtivos] erro:', error)
    return []
  }

  return (data ?? []) as LoteAvulso[]
}

/**
 * Cria um novo lote de créditos avulsos. Validade 3 meses desde NOW.
 * Chamado pelo webhook Asaas quando um pacote_leads_X é pago.
 *
 * `pagamentoId` é o id local de pagamentos_asaas (FK pra rastreio).
 * `tipoOrigem` default 'compra_avulsa' — outras origens (bonus_admin,
 * cortesia) podem ser usadas no futuro sem alterar o schema.
 */
export async function creditarLoteAvulso(params: {
  fornecedorId: string
  quantidade: number
  pagamentoId?: string
  tipoOrigem?: string
}): Promise<
  | { ok: true; loteId: string }
  | { ok: false; erro: string }
> {
  if (params.quantidade <= 0) {
    return { ok: false, erro: 'quantidade deve ser > 0' }
  }

  const expiraEm = new Date()
  expiraEm.setMonth(expiraEm.getMonth() + 3)

  const { data, error } = await supabase
    .from('creditos_avulsos')
    .insert({
      fornecedor_id: params.fornecedorId,
      quantidade_inicial: params.quantidade,
      quantidade_disponivel: params.quantidade,
      pagamento_id: params.pagamentoId ?? null,
      tipo_origem: params.tipoOrigem ?? 'compra_avulsa',
      expira_em: expiraEm.toISOString(),
    })
    .select('id')
    .single()

  if (error || !data) {
    console.error('[planos/creditarLoteAvulso] insert falhou:', error)
    return { ok: false, erro: error?.message ?? 'erro ao inserir' }
  }

  return { ok: true, loteId: (data as { id: string }).id }
}

/**
 * Consome 1 crédito do lote ativo mais antigo (FIFO) via Postgres function
 * com FOR UPDATE — race-safe. Caller geralmente é o handler de aceite,
 * chamado SÓ se a cota mensal estourou.
 *
 * Retorna `{ ok: true, loteId, novoDisponivel }` em sucesso, ou
 * `{ ok: false, erro }` em erro real. Se não há lote ativo, retorna
 * `{ ok: true, loteId: null, novoDisponivel: 0 }` — caller decide.
 */
export async function consumirCreditoAvulso(fornecedorId: string): Promise<
  | { ok: true; loteId: string | null; novoDisponivel: number }
  | { ok: false; erro: string }
> {
  const { data, error } = await supabase.rpc('consumir_credito_avulso', {
    p_fornecedor_id: fornecedorId,
  })

  if (error) {
    console.error('[planos/consumirCreditoAvulso] rpc falhou:', error)
    return { ok: false, erro: error.message }
  }

  const rows = (data ?? []) as Array<{ lote_id: string; novo_disponivel: number }>
  if (rows.length === 0) {
    return { ok: true, loteId: null, novoDisponivel: 0 }
  }

  return {
    ok: true,
    loteId: rows[0].lote_id,
    novoDisponivel: rows[0].novo_disponivel,
  }
}

// ============================================================================
// JANELA DE COTA POR ANIVERSÁRIO DO PLANO
// ============================================================================
//
// Tudo em UTC. Servidor Vercel + BD Supabase rodam UTC. Misturar fuso local
// com UTC é fonte clássica de bugs em transições de meia-noite no BRT (UTC-3).
//
// Edge case do clamp: se o aniversário é dia 31 e o mês corrente tem 30 dias
// (ou 28/29 em fevereiro), a janela começa no último dia do mês.
// ============================================================================

/** Último dia do mês informado (mes é 1-12, não zero-indexed). */
function ultimoDiaDoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate()
}

/**
 * Início da janela de cota corrente do fornecedor (aniversário do plano).
 *
 * Exemplos (NOW = 17 de maio UTC):
 *   aniv dia 14 → janela = 14 de maio (aniversário deste mês já passou)
 *   aniv dia 22 → janela = 22 de abril (aniversário deste mês ainda não chegou)
 *   aniv dia 31, mês com 30 dias → clamp pro dia 30
 */
export function inicioJanelaCotaAtual(planoAtivadoEm: string): Date {
  const ativ = new Date(planoAtivadoEm)
  const diaAniv = ativ.getUTCDate()
  const hoje = new Date()

  // Tenta este mês primeiro
  const ultDiaMesAtual = ultimoDiaDoMes(
    hoje.getUTCFullYear(),
    hoje.getUTCMonth() + 1
  )
  const candidato = new Date(
    Date.UTC(
      hoje.getUTCFullYear(),
      hoje.getUTCMonth(),
      Math.min(diaAniv, ultDiaMesAtual)
    )
  )

  if (candidato <= hoje) {
    return candidato
  }

  // Aniversário deste mês ainda não chegou — janela começou no mês anterior
  const anoAnterior =
    hoje.getUTCMonth() === 0 ? hoje.getUTCFullYear() - 1 : hoje.getUTCFullYear()
  const mesAnterior0 = hoje.getUTCMonth() === 0 ? 11 : hoje.getUTCMonth() - 1
  const ultDiaMesAnterior = ultimoDiaDoMes(anoAnterior, mesAnterior0 + 1)

  return new Date(
    Date.UTC(anoAnterior, mesAnterior0, Math.min(diaAniv, ultDiaMesAnterior))
  )
}

/**
 * Próxima renovação (próximo aniversário no futuro). Usado pra UI mostrar
 * "renova em N dias".
 */
export function proximaRenovacao(planoAtivadoEm: string): Date {
  const ativ = new Date(planoAtivadoEm)
  const diaAniv = ativ.getUTCDate()
  const hoje = new Date()

  // Tenta este mês: se aniversário ainda não chegou, é a próxima renovação
  const ultDiaMesAtual = ultimoDiaDoMes(
    hoje.getUTCFullYear(),
    hoje.getUTCMonth() + 1
  )
  const candidato = new Date(
    Date.UTC(
      hoje.getUTCFullYear(),
      hoje.getUTCMonth(),
      Math.min(diaAniv, ultDiaMesAtual)
    )
  )

  if (candidato > hoje) {
    return candidato
  }

  // Aniversário deste mês já passou (ou é hoje) — próximo é no próximo mês
  const proxAno =
    hoje.getUTCMonth() === 11 ? hoje.getUTCFullYear() + 1 : hoje.getUTCFullYear()
  const proxMes0 = hoje.getUTCMonth() === 11 ? 0 : hoje.getUTCMonth() + 1
  const ultDiaProxMes = ultimoDiaDoMes(proxAno, proxMes0 + 1)

  return new Date(
    Date.UTC(proxAno, proxMes0, Math.min(diaAniv, ultDiaProxMes))
  )
}

/**
 * Início do mês calendário corrente em UTC. Fallback quando o fornecedor não
 * tem plano_ativado_em — equivalente ao comportamento pré-Sprint 3, mas em
 * UTC (era fuso local antes). Hoje todos os 13 fornecedores têm valor; o
 * fallback existe pra defesa contra dados inesperados.
 */
function inicioMesCalendarioUtc(): Date {
  const hoje = new Date()
  return new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1))
}
