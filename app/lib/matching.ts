import { createClient } from '@supabase/supabase-js'

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
}

export async function buscarFornecedorCompativel(pedido: Pedido): Promise<Fornecedor | null> {
  // Bloqueio 1: fornecedores que já tiveram oferta neste pedido
  // (recusada, expirada ou enviada anteriormente — não pode reincidir)
  const { data: ofertasExistentes } = await supabase
    .from('ofertas')
    .select('fornecedor_id')
    .eq('pedido_id', pedido.id)
    .in('status', ['enviada', 'aceita', 'recusada', 'expirada'])

  // Bloqueio 2: fornecedores com oferta ATIVA (status='enviada') em QUALQUER pedido
  // (1 oferta por vez por fornecedor — só recebe nova depois de responder/expirar)
  const { data: ofertasAtivas } = await supabase
    .from('ofertas')
    .select('fornecedor_id')
    .eq('status', 'enviada')

  const excluidosSet = new Set<string>()
  for (const o of ofertasExistentes ?? []) {
    excluidosSet.add((o as { fornecedor_id: string }).fornecedor_id)
  }
  for (const o of ofertasAtivas ?? []) {
    excluidosSet.add((o as { fornecedor_id: string }).fornecedor_id)
  }
  const excluidos: string[] = Array.from(excluidosSet)

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

  const { data, error } = await q
    .order('ultimo_lead_em', { ascending: true, nullsFirst: true })
    .limit(1)

  if (error) {
    console.error('matching error:', error)
    return null
  }

  return (data?.[0] as Fornecedor) ?? null
}
