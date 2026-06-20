// app/lib/fornecedor-pedidos.ts
// ============================================================================
// Painel do fornecedor — modelo novo (jun/2026). Substitui o fluxo antigo
// (ofertas + cota + planos). Aqui o fornecedor vê as ofertas de pedidos pagos
// (ofertas_pedido_assistente): pendentes (ofertada) e aceitas (aceita), e a
// Carteira (saldo a receber = repasses dos pedidos aceitos).
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import { resumirLinhas, type LinhaPedido, type StatusOferta } from './pedido-assistente-oferta'

// Estado derivado de uma oferta ACEITA, conforme o pagamento REAL do cliente:
//  - 'orcar'              -> aceita, mas orcamento ainda nao enviado (orcamento_status !== 'definido')
//  - 'aguardando_cliente' -> orcamento enviado, mas cliente AINDA NAO pagou
//  - 'producao'           -> cliente PAGOU; fornecedor pode produzir; este e o real "a receber"
//  - 'concluido'          -> Confeccione ja repassou o valor ao fornecedor (repasse pago)
export type EstadoOferta = 'orcar' | 'aguardando_cliente' | 'producao' | 'concluido'

export type OfertaFornecedor = {
  ofertaId: string
  pedidoId: string
  status: StatusOferta
  repasseStatus: 'a_receber' | 'pago'
  valorRepasseCentavos: number | null
  criadoEm: string
  totalPecas: number
  resumo: string
  numImagens: number
  linhas: LinhaPedido[]
  pagamentoStatus: string | null
  orcamentoStatus: string | null
  prazoDias: number | null
  clienteNome: string | null
  estado: EstadoOferta
}

type Row = {
  id: string
  pedido_id: string
  status: StatusOferta
  repasse_status: 'a_receber' | 'pago'
  valor_repasse_centavos: number | null
  criado_em: string
  pedidos_assistente: {
    linhas: LinhaPedido[] | null
    imagens: unknown[] | null
    pagamento_status: string | null
    orcamento_status: string | null
    nome: string | null
    prazo_dias: number | null
  } | null
}

function derivarEstado(
  orcamentoStatus: string | null,
  pagamentoStatus: string | null,
  repasseStatus: 'a_receber' | 'pago',
): EstadoOferta {
  if (repasseStatus === 'pago') return 'concluido'
  if (pagamentoStatus === 'pago') return 'producao'
  if (orcamentoStatus === 'definido') return 'aguardando_cliente'
  return 'orcar'
}

function mapRow(o: Row): OfertaFornecedor {
  const ped = o.pedidos_assistente
  const linhas = Array.isArray(ped?.linhas) ? (ped!.linhas as LinhaPedido[]) : []
  const { totalPecas, texto } = resumirLinhas(linhas)
  const pagamentoStatus = ped?.pagamento_status ?? null
  const orcamentoStatus = ped?.orcamento_status ?? null
  return {
    ofertaId: o.id,
    pedidoId: o.pedido_id,
    status: o.status,
    repasseStatus: o.repasse_status,
    valorRepasseCentavos: o.valor_repasse_centavos,
    criadoEm: o.criado_em,
    totalPecas,
    resumo: texto,
    numImagens: Array.isArray(ped?.imagens) ? ped!.imagens!.length : 0,
    linhas,
    pagamentoStatus,
    orcamentoStatus,
    prazoDias: ped?.prazo_dias ?? null,
    clienteNome: ped?.nome ?? null,
    estado: derivarEstado(orcamentoStatus, pagamentoStatus, o.repasse_status),
  }
}

async function buscar(fornecedorId: string, status: StatusOferta[]): Promise<OfertaFornecedor[]> {
  const { data } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('id, pedido_id, status, repasse_status, valor_repasse_centavos, criado_em, pedidos_assistente(linhas, imagens, pagamento_status, orcamento_status, nome, prazo_dias)')
    .eq('fornecedor_id', fornecedorId)
    .in('status', status)
    .order('criado_em', { ascending: false })
  return ((data ?? []) as unknown as Row[]).map(mapRow)
}

export async function pedidosPendentesFornecedor(fornecedorId: string) {
  return buscar(fornecedorId, ['ofertada'])
}
export async function pedidosAceitosFornecedor(fornecedorId: string) {
  return buscar(fornecedorId, ['aceita'])
}

// ---------------------------------------------------------------------------
// Carteira
// ---------------------------------------------------------------------------
export type Carteira = {
  // "A receber" SOMENTE conta pedidos que o CLIENTE realmente pagou e que
  // ainda nao foram repassados ao fornecedor. Pedidos aguardando pagamento do
  // cliente NAO entram aqui.
  saldoAReceberCentavos: number
  totalRecebidoCentavos: number
  // Opcional: orcamentos enviados que ainda aguardam o cliente pagar.
  aguardandoClienteCentavos: number
  itens: Array<{
    ofertaId: string
    pedidoId: string
    valorCentavos: number | null
    repasseStatus: 'a_receber' | 'pago'
    criadoEm: string
    totalPecas: number
    resumo: string
  }>
}

export async function carteiraFornecedor(fornecedorId: string): Promise<Carteira> {
  const aceitas = await pedidosAceitosFornecedor(fornecedorId)
  let aReceber = 0
  let recebido = 0
  let aguardandoCliente = 0
  for (const o of aceitas) {
    const v = o.valorRepasseCentavos ?? 0
    if (o.repasseStatus === 'pago') {
      // Confeccione ja repassou ao fornecedor.
      recebido += v
    } else if (o.pagamentoStatus === 'pago') {
      // Cliente pagou e ainda nao houve repasse -> real "a receber".
      aReceber += v
    } else if (o.orcamentoStatus === 'definido') {
      // Orcamento enviado, aguardando o cliente pagar -> nao conta como a receber.
      aguardandoCliente += v
    }
  }
  return {
    saldoAReceberCentavos: aReceber,
    totalRecebidoCentavos: recebido,
    aguardandoClienteCentavos: aguardandoCliente,
    itens: aceitas.map((o) => ({
      ofertaId: o.ofertaId,
      pedidoId: o.pedidoId,
      valorCentavos: o.valorRepasseCentavos,
      repasseStatus: o.repasseStatus,
      criadoEm: o.criadoEm,
      totalPecas: o.totalPecas,
      resumo: o.resumo,
    })),
  }
}

// ---------------------------------------------------------------------------
// Dados de repasse (conta bancária + PIX) do fornecedor
// ---------------------------------------------------------------------------
export type DadosRepasse = {
  pix_chave: string | null
  pix_tipo: string | null
  banco_nome: string | null
  banco_agencia: string | null
  banco_conta: string | null
  banco_titular: string | null
}

export async function obterDadosRepasse(fornecedorId: string): Promise<DadosRepasse> {
  const { data } = await supabaseAdmin
    .from('leads_fornecedores')
    .select('pix_chave, pix_tipo, banco_nome, banco_agencia, banco_conta, banco_titular')
    .eq('id', fornecedorId)
    .maybeSingle<DadosRepasse>()
  return (
    data ?? {
      pix_chave: null, pix_tipo: null, banco_nome: null,
      banco_agencia: null, banco_conta: null, banco_titular: null,
    }
  )
}

export async function salvarDadosRepasse(fornecedorId: string, dados: Partial<DadosRepasse>): Promise<{ ok: boolean; erro?: string }> {
  const limpo: Record<string, string | null> = {}
  for (const k of ['pix_chave', 'pix_tipo', 'banco_nome', 'banco_agencia', 'banco_conta', 'banco_titular'] as const) {
    if (k in dados) {
      const v = (dados as any)[k]
      limpo[k] = typeof v === 'string' ? v.trim() || null : null
    }
  }
  const { error } = await supabaseAdmin.from('leads_fornecedores').update(limpo).eq('id', fornecedorId)
  if (error) return { ok: false, erro: error.message }
  return { ok: true }
}
