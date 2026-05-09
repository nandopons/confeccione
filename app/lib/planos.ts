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

export type Plano = 'free' | 'starter' | 'pro' | 'enterprise'

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
    preco_mes: 79,
    leads_inclusos: 15,
    preco_lead_extra: 12,
  },
  pro: {
    nome: 'Pro',
    preco_mes: 199,
    leads_inclusos: 30,
    preco_lead_extra: 10,
  },
  enterprise: {
    nome: 'Enterprise',
    preco_mes: 499,
    leads_inclusos: 50,
    preco_lead_extra: 8,
  },
}

// Pacotes de leads extras avulsos (cliente escolhe na hora do upgrade)
export const PACOTES_LEADS_EXTRAS = [
  { quantidade: 5, label: '5 leads' },
  { quantidade: 10, label: '10 leads' },
  { quantidade: 25, label: '25 leads' },
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
 * no mês corrente. Apenas status='aceita' consome cota — leads recebidos
 * mas recusados/expirados não contam (decisão revisada em 2026-05-09).
 *
 * Razão: contar só o que o fornecedor de fato converteu evita injustiça
 * com quem recebe ofertas mas não tem fit pra elas.
 */
export async function contarOfertasMesAtual(fornecedorId: string): Promise<number> {
  const inicioMes = new Date()
  inicioMes.setDate(1)
  inicioMes.setHours(0, 0, 0, 0)

  const { count } = await supabase
    .from('ofertas')
    .select('*', { count: 'exact', head: true })
    .eq('fornecedor_id', fornecedorId)
    .eq('tipo_oferta', 'normal')
    .eq('status', 'aceita')
    .gte('enviada_em', inicioMes.toISOString())

  return count ?? 0
}

/**
 * Verifica se o fornecedor ainda tem crédito pra receber oferta normal.
 * Considera créditos extras (pacotes) + cota mensal do plano.
 */
export async function temCreditoDisponivel(fornecedor: {
  id: string
  plano: Plano
  plano_expira_em: string | null
  creditos_extras: number
}): Promise<{
  tem_credito: boolean
  usados_no_mes: number
  limite_mes: number
  creditos_extras: number
}> {
  const planoAtual = planoEfetivo(fornecedor)
  const config = PLANOS_CONFIG[planoAtual]
  const usados = await contarOfertasMesAtual(fornecedor.id)

  // Crédito vem de duas fontes: cota mensal + extras avulsos
  const tem_credito =
    usados < config.leads_inclusos || fornecedor.creditos_extras > 0

  return {
    tem_credito,
    usados_no_mes: usados,
    limite_mes: config.leads_inclusos,
    creditos_extras: fornecedor.creditos_extras,
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

/**
 * Consome um crédito do fornecedor (usado quando uma oferta NORMAL é
 * registrada). Prioriza créditos extras antes da cota mensal.
 *
 * IMPORTANTE: a cota mensal não é "consumida" aqui — ela é contada via
 * vw_ofertas_mes_corrente / contarOfertasMesAtual a partir das ofertas
 * registradas. Aqui só decrementamos créditos extras quando aplicável.
 */
export async function consumirCreditoExtra(
  fornecedorId: string,
  fornecedorAtual: { plano: Plano; plano_expira_em: string | null; creditos_extras: number }
): Promise<void> {
  const planoAtual = planoEfetivo(fornecedorAtual)
  const config = PLANOS_CONFIG[planoAtual]
  const usados = await contarOfertasMesAtual(fornecedorId)

  // Só consome crédito extra SE a cota mensal já foi atingida.
  // Antes disso, a cota cobre, e os extras ficam pra depois.
  if (usados >= config.leads_inclusos && fornecedorAtual.creditos_extras > 0) {
    await supabase
      .from('leads_fornecedores')
      .update({ creditos_extras: fornecedorAtual.creditos_extras - 1 })
      .eq('id', fornecedorId)
  }
}
