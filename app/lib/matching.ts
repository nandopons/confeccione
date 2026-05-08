import { createClient } from '@supabase/supabase-js'
import { temCreditoDisponivel, planoEfetivo, type Plano } from './planos'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export type Pedido = {
  id: string
  tipo: string
  quantidade: number | null
  prazo: string
  estado: string
  nome: string
  whatsapp: string
  email: string | null
  descricao: string | null
  status: string
}

export type Fornecedor = {
  id: string
  nome: string
  whatsapp: string
  email: string | null
  tipos_produto: string[]
  pedido_minimo: number
  estado: string
  raio_atendimento: string
  status: string
  ultimo_lead_em: string | null
  plano: Plano
  plano_expira_em: string | null
  creditos_extras: number
}

export type ResultadoMatching = {
  fornecedor: Fornecedor
  tem_credito: boolean
}

/**
 * Busca o melhor fornecedor compatível para um pedido, respeitando:
 *
 * 1. PRIORIDADE: fornecedores com crédito ativo vêm primeiro.
 *    Se não houver, oferece pra um sem crédito (com gatilho de upgrade).
 *
 * 2. EXCLUSÕES (regras de re-oferta):
 *    - Quem disse NÃO ou expirou normal → nunca mais recebe esse pedido
 *    - Quem expirou_sem_credito (recebeu gatilho mas não comprou em 3h)
 *      → PODE receber de novo se ganhar crédito (upgrade/pacote)
 *    - Quem recusou_sem_credito ("não tenho interesse") → nunca mais
 *    - Quem tem oferta ATIVA em qualquer pedido → bloqueado até resolver
 *
 * 3. COMPATIBILIDADE: tipo de produto, pedido_minimo, raio de atendimento.
 */
export async function buscarFornecedorCompativel(
  pedido: Pedido
): Promise<ResultadoMatching | null> {
  // ============================================================
  // BLOQUEIOS: quem está EXCLUÍDO de receber esse pedido
  // ============================================================

  // Bloqueio 1: já receberam oferta DEFINITIVA neste pedido.
  // 'expirada_sem_credito' NÃO entra aqui — é re-ofertável se ganhar crédito.
  const { data: ofertasDefinitivas } = await supabase
    .from('ofertas')
    .select('fornecedor_id')
    .eq('pedido_id', pedido.id)
    .in('status', [
      'enviada', // tem oferta ativa neste pedido (já recebeu)
      'aceita',
      'recusada',
      'expirada',
      'recusada_sem_credito', // disse "não tenho interesse" no gatilho
    ])

  // Bloqueio 2: tem oferta ATIVA (status='enviada') em QUALQUER pedido.
  // Inclui ofertas normais e ofertas sem crédito ainda na janela de 3h.
  const { data: ofertasAtivas } = await supabase
    .from('ofertas')
    .select('fornecedor_id')
    .eq('status', 'enviada')

  const excluidosSet = new Set<string>()
  for (const o of ofertasDefinitivas ?? []) {
    excluidosSet.add((o as { fornecedor_id: string }).fornecedor_id)
  }
  for (const o of ofertasAtivas ?? []) {
    excluidosSet.add((o as { fornecedor_id: string }).fornecedor_id)
  }
  const excluidos: string[] = Array.from(excluidosSet)

  // ============================================================
  // BUSCA: todos os fornecedores compatíveis
  // ============================================================
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = supabase
    .from('leads_fornecedores')
    .select('*')
    .eq('status', 'ativo')
    .contains('tipos_produto', [pedido.tipo])
    .or(
      `raio_atendimento.eq.nacional,and(raio_atendimento.in.(estado,regiao),estado.eq.${pedido.estado})`
    )

  if (excluidos.length > 0) {
    q = q.not('id', 'in', `(${excluidos.join(',')})`)
  }

  if (pedido.quantidade !== null) {
    q = q.lte('pedido_minimo', pedido.quantidade)
  }

  // Limita a 50 candidatos pra calcular crédito sem custo proibitivo
  const { data, error } = await q
    .order('ultimo_lead_em', { ascending: true, nullsFirst: true })
    .limit(50)

  if (error) {
    console.error('matching error:', error)
    return null
  }

  const candidatos = (data ?? []) as Fornecedor[]
  if (candidatos.length === 0) return null

  // ============================================================
  // CLASSIFICAÇÃO: separar com crédito vs sem crédito
  // ============================================================
  const creditos = await Promise.all(
    candidatos.map(async (f) => {
      const c = await temCreditoDisponivel({
        id: f.id,
        plano: planoEfetivo({ plano: f.plano, plano_expira_em: f.plano_expira_em }),
        plano_expira_em: f.plano_expira_em,
        creditos_extras: f.creditos_extras,
      })
      return { fornecedor: f, tem_credito: c.tem_credito }
    })
  )

  // Prioriza quem tem crédito (mantém ordem ultimo_lead_em ASC)
  const comCredito = creditos.find((c) => c.tem_credito)
  if (comCredito) {
    return comCredito
  }

  // Se NINGUÉM tem crédito: oferece pro primeiro sem crédito que ainda não
  // recebeu gatilho neste pedido específico.
  const { data: gatilhosNeste } = await supabase
    .from('ofertas')
    .select('fornecedor_id')
    .eq('pedido_id', pedido.id)
    .eq('status', 'expirada_sem_credito')

  const jaRecebeuGatilhoNestePedido = new Set(
    (gatilhosNeste ?? []).map((o) => (o as { fornecedor_id: string }).fornecedor_id)
  )

  const semCreditoElegivel = creditos.find(
    (c) => !c.tem_credito && !jaRecebeuGatilhoNestePedido.has(c.fornecedor.id)
  )

  return semCreditoElegivel ?? null
}
