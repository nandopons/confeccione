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
  capacidade_min: number
  capacidade_max: number | null
  estado: string
  raio_atendimento: string
  status: string
  ultimo_lead_em: string | null
}

export async function buscarFornecedorCompativel(pedido: Pedido): Promise<Fornecedor | null> {
  const { data: ofertasExistentes } = await supabase
    .from('ofertas')
    .select('fornecedor_id')
    .eq('pedido_id', pedido.id)
    .in('status', ['enviada', 'aceita', 'recusada'])

  const excluidos: string[] = (ofertasExistentes ?? []).map(
    (o: { fornecedor_id: string }) => o.fornecedor_id
  )

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
    q = q
      .lte('capacidade_min', pedido.quantidade)
      .or(`capacidade_max.is.null,capacidade_max.gte.${pedido.quantidade}`)
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
