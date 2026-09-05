import { createClient } from '@supabase/supabase-js'
import { temCreditoDisponivel, planoEfetivo, type Plano } from './planos'
import { legadoDasPecas } from './pecas'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export type Pedido = {
  id: string
  tipo: string
  /** Primeira peça escolhida (app/lib/pecas.ts). Null nos pedidos antigos. */
  peca?: string | null
  /** Todas as peças do pedido. `peca` é a primeira delas. */
  pecas?: string[] | null
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
  /** Peças que a confecção produz. Vazio nos cadastros ainda não migrados. */
  pecas?: string[] | null
  pedido_minimo: number
  estado: string
  raio_atendimento: string
  status: string
  ultimo_lead_em: string | null
  plano: Plano
  plano_expira_em: string | null
  plano_ativado_em: string | null
  creditos_extras: number
}

export type ResultadoMatching = {
  fornecedor: Fornecedor
  tem_credito: boolean
}

// ============================================================================
// REGRA DE COMPATIBILIDADE (fonte única)
// ============================================================================

/** Status de fornecedor que aceita ofertas. Outros valores ('pausado')
 *  significam fornecedor existe mas não quer receber leads agora. */
export const STATUS_FORNECEDOR_ATIVO = 'ativo' as const

/** As peças que o pedido pede, em uma lista só.
 *
 *  `pecas` é o conjunto (o cliente pode marcar camiseta + moletom); `peca` é a
 *  primeira, mantida porque o resto do sistema já lê essa coluna. Pedidos
 *  antigos não têm nenhuma das duas. */
export function pecasDoPedido(pedido: {
  peca?: string | null
  pecas?: string[] | null
}): string[] {
  if (pedido.pecas && pedido.pecas.length > 0) return pedido.pecas
  return pedido.peca ? [pedido.peca] : []
}

/**
 * Quantas das peças do pedido essa confecção cobre? (05/09/2026)
 *
 * Três situações convivem enquanto a migração de categoria → peça acontece:
 *
 *   1. os dois já falam PEÇA  → compara peça com peça. É o caso bom, e o único
 *      que responde "essa confecção faz polo?".
 *   2. o pedido tem peça, o fornecedor ainda não  → traduz as peças pras
 *      categorias antigas equivalentes e olha `tipos_produto`. Sem isso, o
 *      primeiro pedido no vocabulário novo não acharia nenhum dos 41
 *      cadastros existentes. A cobertura vira 1 (ou 0): categoria não tem
 *      resolução pra dizer quantas peças a confecção faz.
 *   3. o pedido é antigo, sem peça  → segue na categoria, como sempre foi.
 */
export function coberturaDoPedido(
  fornecedor: { tipos_produto?: string[] | null; pecas?: string[] | null },
  pedido: { tipo: string; peca?: string | null; pecas?: string[] | null },
): number {
  const pecasFornecedor = fornecedor.pecas ?? []
  const tipos = fornecedor.tipos_produto ?? []
  const pedidas = pecasDoPedido(pedido)

  if (pedidas.length > 0) {
    if (pecasFornecedor.length > 0) {
      return pedidas.filter((p) => pecasFornecedor.includes(p)).length
    }
    const legado = legadoDasPecas(pedidas)
    return legado.some((cat) => tipos.includes(cat)) ? 1 : 0
  }

  return tipos.includes(pedido.tipo) ? 1 : 0
}

/**
 * O fornecedor produz o que o pedido pede?
 *
 * Basta cobrir UMA das peças. Exigir o pedido inteiro deixaria sem fornecedor
 * quem pediu camiseta + boné só porque ninguém faz as duas coisas — e o pedido
 * é divisível: o resto vai pra outra confecção. Quem cobre mais peças ganha a
 * frente da fila em buscarFornecedorCompativel.
 */
export function produzOQuePedem(
  fornecedor: { tipos_produto?: string[] | null; pecas?: string[] | null },
  pedido: { tipo: string; peca?: string | null; pecas?: string[] | null },
): boolean {
  return coberturaDoPedido(fornecedor, pedido) > 0
}

/** Regra pura: o fornecedor atende este pedido? Sem I/O, sem queries.
 *
 *  Fonte única da regra de compatibilidade — inclusive pra
 *  buscarFornecedorCompativel, que usa a query SQL só pra estreitar o
 *  candidato e chama produzOQuePedem pra decidir. Mudou aqui, mudou no
 *  sistema todo.
 *
 *  NÃO considera exclusões dinâmicas (ofertas em andamento, gatilhos
 *  expirados, crédito) — essas são responsabilidade da função de busca. */
export function fornecedorAtendePedido(
  fornecedor: Pick<
    Fornecedor,
    'status' | 'tipos_produto' | 'pedido_minimo' | 'raio_atendimento' | 'estado'
  > & { pecas?: string[] | null },
  pedido: Pick<Pedido, 'tipo' | 'quantidade' | 'estado'> & {
    peca?: string | null
    pecas?: string[] | null
  },
): boolean {
  if (fornecedor.status !== STATUS_FORNECEDOR_ATIVO) return false

  if (!produzOQuePedem(fornecedor, pedido)) return false

  // pedido_minimo só vale se quantidade foi informada.
  if (pedido.quantidade !== null && pedido.quantidade < fornecedor.pedido_minimo) {
    return false
  }

  // Raio: 'nacional' aceita qualquer estado; 'estado' e 'regiao' exigem
  // mesmo estado (valores reais no schema, ver app/fornecedor/cadastro).
  const cobreEstado =
    fornecedor.raio_atendimento === 'nacional' ||
    fornecedor.estado === pedido.estado
  if (!cobreEstado) return false

  return true
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
    .eq('status', STATUS_FORNECEDOR_ATIVO)
    .eq('aprovacao_status', 'aprovado')

  // Filtro de produto: a query traz um SUPERCONJUNTO e produzOQuePedem
  // (regra pura, logo abaixo) decide. Fazer o desempate "tem peça? ignora
  // categoria" em SQL exigiria um OR aninhado difícil de manter — e a regra
  // ficaria escrita em dois lugares, que é justamente o que dá divergência.
  const pedidas = pecasDoPedido(pedido)
  if (pedidas.length > 0) {
    const legado = legadoDasPecas(pedidas)
    const condicoes = [`pecas.ov.{${pedidas.join(',')}}`]
    if (legado.length > 0) condicoes.push(`tipos_produto.ov.{${legado.join(',')}}`)
    q = q.or(condicoes.join(','))
  } else {
    q = q.contains('tipos_produto', [pedido.tipo])
  }

  q = q.or(
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

  // Aplica a regra pura sobre o superconjunto que a query trouxe, e ordena por
  // COBERTURA: num pedido de camiseta + moletom, quem faz os dois atende antes
  // de quem faz um. O desempate continua sendo ultimo_lead_em (a ordem que veio
  // do banco), que é o rodízio — cobertura não pode virar monopólio de quem
  // marcou peça demais.
  const candidatos = ((data ?? []) as Fornecedor[])
    .map((f) => ({ f, cobertura: coberturaDoPedido(f, pedido) }))
    .filter((c) => c.cobertura > 0)
    .sort((a, b) => b.cobertura - a.cobertura)
    .map((c) => c.f)
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
        plano_ativado_em: f.plano_ativado_em,
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
