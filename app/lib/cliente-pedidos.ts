// app/lib/cliente-pedidos.ts
// Lista os pedidos do fluxo novo (pedidos_assistente) de um cliente, casando
// pelo e-mail da conta logada (os pedidos do chat são criados com e-mail, sem
// conta_id obrigatório).
import { supabaseAdmin } from './supabase-server'
import { resumirLinhas, type LinhaPedido } from './pedido-assistente-oferta'

export type PedidoClienteAssistente = {
  id: string
  status: string | null
  pagamentoStatus: string | null
  valorCentavos: number | null
  criadoEm: string
  totalPecas: number
  resumo: string
  numImagens: number
}

export async function pedidosAssistenteDoCliente(email: string | null | undefined): Promise<PedidoClienteAssistente[]> {
  if (!email) return []
  const emailNorm = email.trim().toLowerCase()
  const { data } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, status, pagamento_status, valor_centavos, criado_em, linhas, imagens')
    .ilike('email', emailNorm)
    .order('criado_em', { ascending: false })

  return ((data ?? []) as any[]).map((p) => {
    const linhas = Array.isArray(p.linhas) ? (p.linhas as LinhaPedido[]) : []
    const { totalPecas, texto } = resumirLinhas(linhas)
    return {
      id: p.id,
      status: p.status ?? null,
      pagamentoStatus: p.pagamento_status ?? null,
      valorCentavos: p.valor_centavos ?? null,
      criadoEm: p.criado_em,
      totalPecas,
      resumo: texto,
      numImagens: Array.isArray(p.imagens) ? p.imagens.length : 0,
    }
  })
}
