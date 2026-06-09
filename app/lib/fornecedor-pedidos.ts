// app/lib/fornecedor-pedidos.ts
// ============================================================================
// Painel do fornecedor — modelo novo (jun/2026). Substitui o fluxo antigo
// (ofertas + cota + planos). Aqui o fornecedor vê as ofertas de pedidos pagos
// (ofertas_pedido_assistente): pendentes (ofertada) e aceitas (aceita), e a
// Carteira (saldo a receber = repasses dos pedidos aceitos).
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import { resumirLinhas, type LinhaPedido, type StatusOferta } from './pedido-assistente-oferta'

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
}

type Row = {
  id: string
  pedido_id: string
  status: StatusOferta
  repasse_status: 'a_receber' | 'pago'
  valor_repasse_centavos: number | null
  criado_em: string
  pedidos_assistente: { linhas: LinhaPedido[] | null; imagens: unknown[] | null } | null
}

function mapRow(o: Row): OfertaFornecedor {
  const linhas = Array.isArray(o.pedidos_assistente?.linhas) ? (o.pedidos_assistente!.linhas as LinhaPedido[]) : []
  const { totalPecas, texto } = resumirLinhas(linhas)
  return {
    ofertaId: o.id,
    pedidoId: o.pedido_id,
    status: o.status,
    repasseStatus: o.repasse_status,
    valorRepasseCentavos: o.valor_repasse_centavos,
    criadoEm: o.criado_em,
    totalPecas,
    resumo: texto,
    numImagens: Array.isArray(o.pedidos_assistente?.imagens) ? o.pedidos_assistente!.imagens!.length : 0,
    linhas,
  }
}

async function buscar(fornecedorId: string, status: StatusOferta[]): Promise<OfertaFornecedor[]> {
  const { data } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('id, pedido_id, status, repasse_status, valor_repasse_centavos, criado_em, pedidos_assistente(linhas, imagens)')
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
  saldoAReceberCentavos: number
  totalRecebidoCentavos: number
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
  for (const o of aceitas) {
    const v = o.valorRepasseCentavos ?? 0
    if (o.repasseStatus === 'pago') recebido += v
    else aReceber += v
  }
  return {
    saldoAReceberCentavos: aReceber,
    totalRecebidoCentavos: recebido,
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
