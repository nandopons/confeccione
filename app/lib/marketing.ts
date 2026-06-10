// app/lib/marketing.ts
// ============================================================================
// Dados do painel de MARKETING: base completa de leads (pedidos_assistente),
// fase de funil derivada, interesse (produtos), KPIs e funil agregado.
// Fases: montado (etapa 1 completa) → visualizador (gerou mockup) →
// cobranca (gerou PIX/cartão, não pagou) → pago.
// ============================================================================

import { supabaseAdmin } from './supabase-server'

export type FaseLead = 'montado' | 'visualizador' | 'cobranca' | 'pago'

export const FASE_LABEL: Record<FaseLead, string> = {
  montado: 'Pedido montado',
  visualizador: 'Viu o visualizador',
  cobranca: 'Cobrança gerada',
  pago: 'Pago',
}

export type LeadMarketing = {
  id: string
  criadoEm: string
  atualizadoEm: string | null
  nome: string | null
  telefone: string | null
  email: string | null
  cidade: string | null
  uf: string | null
  fase: FaseLead
  interesse: string
  totalPecas: number
  valorCentavos: number | null
}

export type DadosMarketing = {
  kpis: {
    leads: number
    pagos: number
    faturamentoCentavos: number
    cobrancas: number
    aReceberCentavos: number
    semCobranca: number
    conversaoPct: number
  }
  funil: Array<{ fase: FaseLead; label: string; quantidade: number }>
  leads: LeadMarketing[]
}

type LinhaJson = {
  modelo?: string | null
  cor?: string | null
  total?: number | null
  tamanhos?: Array<{ qtd?: number | null }> | null
}

type PedidoRow = {
  id: string
  criado_em: string
  atualizado_em: string | null
  nome: string | null
  telefone: string | null
  email: string | null
  cidade: string | null
  uf: string | null
  pagamento_status: string | null
  asaas_payment_id: string | null
  valor_centavos: number | null
  linhas: LinhaJson[] | null
  mockups: Record<string, unknown> | null
}

function interesseDasLinhas(linhas: LinhaJson[] | null): { interesse: string; totalPecas: number } {
  let totalPecas = 0
  const partes: string[] = []
  for (const l of linhas ?? []) {
    const qtd = typeof l.total === 'number' ? l.total : (l.tamanhos ?? []).reduce((s, t) => s + (t.qtd ?? 0), 0)
    totalPecas += qtd || 0
    partes.push(`${qtd || '?'}× ${l.modelo ?? 'peça'}${l.cor ? ` ${l.cor}` : ''}`)
  }
  return { interesse: partes.join(' · ') || '—', totalPecas }
}

export function faseDoPedido(p: Pick<PedidoRow, 'pagamento_status' | 'asaas_payment_id' | 'mockups'>): FaseLead {
  if (p.pagamento_status === 'pago') return 'pago'
  if (p.pagamento_status === 'gerado' || p.asaas_payment_id) return 'cobranca'
  if (p.mockups && Object.keys(p.mockups).length > 0) return 'visualizador'
  return 'montado'
}

export async function listarLeadsMarketing(): Promise<LeadMarketing[]> {
  const { data } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, criado_em, atualizado_em, nome, telefone, email, cidade, uf, pagamento_status, asaas_payment_id, valor_centavos, linhas, mockups')
    .order('criado_em', { ascending: false })

  return ((data ?? []) as PedidoRow[]).map((p) => {
    const { interesse, totalPecas } = interesseDasLinhas(p.linhas)
    return {
      id: p.id,
      criadoEm: p.criado_em,
      atualizadoEm: p.atualizado_em,
      nome: p.nome,
      telefone: p.telefone,
      email: p.email,
      cidade: p.cidade,
      uf: p.uf,
      fase: faseDoPedido(p),
      interesse,
      totalPecas,
      valorCentavos: p.valor_centavos,
    }
  })
}

export async function dadosMarketing(): Promise<DadosMarketing> {
  const leads = await listarLeadsMarketing()

  const porFase = (f: FaseLead) => leads.filter((l) => l.fase === f)
  const pagos = porFase('pago')
  const cobrancas = porFase('cobranca')
  const visualizador = porFase('visualizador')
  const montado = porFase('montado')

  const faturamentoCentavos = pagos.reduce((s, l) => s + (l.valorCentavos ?? 0), 0)
  const aReceberCentavos = cobrancas.reduce((s, l) => s + (l.valorCentavos ?? 0), 0)

  return {
    kpis: {
      leads: leads.length,
      pagos: pagos.length,
      faturamentoCentavos,
      cobrancas: cobrancas.length,
      aReceberCentavos,
      semCobranca: montado.length + visualizador.length,
      conversaoPct: leads.length > 0 ? Math.round((pagos.length / leads.length) * 100) : 0,
    },
    funil: [
      { fase: 'montado', label: FASE_LABEL.montado, quantidade: leads.length },
      { fase: 'visualizador', label: FASE_LABEL.visualizador, quantidade: visualizador.length + cobrancas.length + pagos.length },
      { fase: 'cobranca', label: FASE_LABEL.cobranca, quantidade: cobrancas.length + pagos.length },
      { fase: 'pago', label: FASE_LABEL.pago, quantidade: pagos.length },
    ],
    leads,
  }
}

/** CSV (com BOM, separador ;) da base de leads — backup/planilha. */
export function leadsParaCsv(leads: LeadMarketing[], siteUrl: string): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v)
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const linhas = [
    ['nome', 'whatsapp', 'email', 'cidade', 'uf', 'fase', 'interesse', 'total_pecas', 'valor_reais', 'criado_em', 'link_visualizador'].join(';'),
    ...leads.map((l) =>
      [
        esc(l.nome),
        esc(l.telefone),
        esc(l.email),
        esc(l.cidade),
        esc(l.uf),
        esc(FASE_LABEL[l.fase]),
        esc(l.interesse),
        l.totalPecas,
        l.valorCentavos != null ? (l.valorCentavos / 100).toFixed(2).replace('.', ',') : '',
        esc(l.criadoEm),
        `${siteUrl}/visualizador/${l.id}`,
      ].join(';')
    ),
  ]
  return '﻿' + linhas.join('\n')
}
