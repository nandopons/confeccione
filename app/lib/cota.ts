// app/lib/cota.ts
// ============================================================================
// Helper consolidado pra exibir informações de cota mensal e plano no painel.
// Combina dados de planos.ts + leads_fornecedores em uma estrutura única.
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import {
  PLANOS_CONFIG,
  contarOfertasMesAtual,
  planoEfetivo,
  type Plano,
} from './planos'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export type CotaInfo = {
  /** Plano efetivo (já considera se trial expirou) */
  plano: Plano
  /** Nome amigável do plano (Free/Starter/Pro/Enterprise) */
  planoNome: string

  /** É trial? (não-free + plano_expira_em no futuro) */
  emTrial: boolean
  /** Data ISO em que o trial expira; só preenche se emTrial=true */
  trialExpiraEm: string | null

  /** Leads inclusos no plano por mês */
  leadsInclusos: number
  /** Leads usados no mês atual (ofertas enviadas e respondidas) */
  leadsUsados: number
  /** Créditos extras comprados (não expiram) */
  creditosExtras: number

  /** Sobra do plano: leadsInclusos - leadsUsados (mínimo 0) */
  saldoMensal: number
  /** Sobra total: saldoMensal + creditosExtras */
  saldoTotal: number

  /** Porcentagem da cota mensal usada (0-100) */
  porcentagemUsada: number
  /** true se o fornecedor já estourou a cota mensal */
  cotaEstourada: boolean
}

/**
 * Calcula a cota e plano consolidados de um fornecedor.
 * Use no dashboard e na página de plano.
 */
export async function calcularCotaInfo(fornecedorId: string): Promise<CotaInfo | null> {
  const { data: fornecedor } = await supabase
    .from('leads_fornecedores')
    .select('id, plano, plano_expira_em, plano_ativado_em, creditos_extras')
    .eq('id', fornecedorId)
    .single()

  if (!fornecedor) return null

  const plano = planoEfetivo({
    plano: fornecedor.plano,
    plano_expira_em: fornecedor.plano_expira_em,
  })

  const config = PLANOS_CONFIG[plano]
  const leadsUsados = await contarOfertasMesAtual(fornecedorId)
  const creditosExtras = fornecedor.creditos_extras ?? 0

  const saldoMensal = Math.max(0, config.leads_inclusos - leadsUsados)
  const saldoTotal = saldoMensal + creditosExtras

  const porcentagemUsada =
    config.leads_inclusos > 0
      ? Math.min(100, Math.round((leadsUsados / config.leads_inclusos) * 100))
      : 0

  // É trial se: plano não-free + plano_expira_em no futuro
  // (assinatura paga tem plano_expira_em = NULL)
  const agora = Date.now()
  const expiraEm = fornecedor.plano_expira_em
    ? new Date(fornecedor.plano_expira_em).getTime()
    : null
  const emTrial = plano !== 'free' && expiraEm !== null && expiraEm > agora

  return {
    plano,
    planoNome: config.nome,
    emTrial,
    trialExpiraEm: emTrial ? fornecedor.plano_expira_em : null,
    leadsInclusos: config.leads_inclusos,
    leadsUsados,
    creditosExtras,
    saldoMensal,
    saldoTotal,
    porcentagemUsada,
    cotaEstourada: leadsUsados >= config.leads_inclusos,
  }
}

/**
 * Formata data ISO pra "23 de julho" (sem ano se for o atual).
 */
export function formatarDataAmigavel(iso: string): string {
  const d = new Date(iso)
  const meses = [
    'janeiro',
    'fevereiro',
    'março',
    'abril',
    'maio',
    'junho',
    'julho',
    'agosto',
    'setembro',
    'outubro',
    'novembro',
    'dezembro',
  ]
  const dia = d.getDate()
  const mes = meses[d.getMonth()]
  const anoAtual = new Date().getFullYear()
  if (d.getFullYear() !== anoAtual) {
    return `${dia} de ${mes} de ${d.getFullYear()}`
  }
  return `${dia} de ${mes}`
}

/**
 * Retorna quantos dias faltam até uma data ISO. Negativo se já passou.
 */
export function diasAte(iso: string): number {
  const alvo = new Date(iso).getTime()
  const agora = Date.now()
  return Math.ceil((alvo - agora) / (24 * 60 * 60 * 1000))
}
