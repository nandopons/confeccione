// app/lib/admin-pedidos-assistente.ts
// Admin: lista e detalha os pedidos do fluxo de chat (pedidos_assistente),
// com foco nos NÃO concluídos (não pagos), pra revisar conversa + mockups/artes.
import { supabaseAdmin } from './supabase-server'

type LinhaJson = {
  modelo?: string | null; cor?: string | null; material?: string | null
  publico?: string | null; total?: number | null
  tamanhos?: Array<{ tamanho?: string | null; qtd?: number | null }> | null
  estampado?: boolean | null; estampas?: unknown[] | null; descricao?: string | null
}

export type PedidoChatResumo = {
  id: string
  criadoEm: string
  nome: string | null
  telefone: string | null
  email: string | null
  status: string | null
  pagamentoStatus: string | null
  valorCentavos: number | null
  totalPecas: number
  resumo: string
  concluido: boolean
}

function totalEResumo(linhas: LinhaJson[]): { totalPecas: number; resumo: string } {
  let totalPecas = 0
  const partes: string[] = []
  for (const l of linhas || []) {
    const qtd = typeof l.total === 'number' ? l.total : (l.tamanhos || []).reduce((s, t) => s + (t.qtd || 0), 0)
    totalPecas += qtd || 0
    const pub = l.publico && l.publico !== 'unissex' ? ` ${l.publico}` : ''
    partes.push(`${qtd || '?'}× ${l.modelo ?? 'peça'}${pub}${l.cor ? ` ${l.cor}` : ''}`)
  }
  return { totalPecas, resumo: partes.join(' · ') }
}

export async function listarPedidosChat(filtro: 'incompletos' | 'todos'): Promise<PedidoChatResumo[]> {
  let q = supabaseAdmin
    .from('pedidos_assistente')
    .select('id, criado_em, nome, telefone, email, status, pagamento_status, valor_centavos, linhas')
    .order('criado_em', { ascending: false })
    .limit(200)
  if (filtro === 'incompletos') q = q.neq('pagamento_status', 'pago')
  const { data } = await q
  return ((data ?? []) as any[]).map((p) => {
    const linhas = Array.isArray(p.linhas) ? (p.linhas as LinhaJson[]) : []
    const { totalPecas, resumo } = totalEResumo(linhas)
    return {
      id: p.id, criadoEm: p.criado_em, nome: p.nome, telefone: p.telefone, email: p.email,
      status: p.status, pagamentoStatus: p.pagamento_status, valorCentavos: p.valor_centavos,
      totalPecas, resumo, concluido: p.pagamento_status === 'pago',
    }
  })
}

export type ConversaItem = { role: 'user' | 'assistant'; texto: string }
export type PedidoChatDetalhe = {
  id: string
  contato: {
    nome: string | null; telefone: string | null; email: string | null
    cep: string | null; complemento: string | null
    logradouro: string | null; bairro: string | null; cidade: string | null; uf: string | null
    prazoDias: number | null
  }
  linhas: LinhaJson[]
  conversa: ConversaItem[]
  mockups: Array<{ index: number; temLiso: boolean; temArte: boolean }>
}

export async function detalharPedidoChat(id: string): Promise<PedidoChatDetalhe | null> {
  const { data } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, nome, telefone, email, cep, complemento, logradouro, bairro, cidade, uf, prazo_dias, linhas, conversa, mockups')
    .eq('id', id)
    .maybeSingle<any>()
  if (!data) return null
  const mockupsRaw = data.mockups && typeof data.mockups === 'object' ? data.mockups : {}
  const mockups = Object.keys(mockupsRaw)
    .map(Number).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b)
    .map((i) => ({ index: i, temLiso: !!mockupsRaw[String(i)]?.liso, temArte: !!mockupsRaw[String(i)]?.arte }))
  return {
    id: data.id,
    contato: {
      nome: data.nome, telefone: data.telefone, email: data.email,
      cep: data.cep, complemento: data.complemento, logradouro: data.logradouro,
      bairro: data.bairro, cidade: data.cidade, uf: data.uf, prazoDias: data.prazo_dias,
    },
    linhas: Array.isArray(data.linhas) ? data.linhas : [],
    conversa: Array.isArray(data.conversa) ? data.conversa : [],
    mockups,
  }
}

// Bytes de um mockup salvo (liso/arte) de uma linha — pro admin renderizar.
export async function imagemMockup(id: string, linha: number, tipo: 'liso' | 'arte'): Promise<{ mime: string; bytes: Buffer } | null> {
  const { data } = await supabaseAdmin.from('pedidos_assistente').select('mockups').eq('id', id).maybeSingle<{ mockups: Record<string, { liso?: string; arte?: string }> | null }>()
  const dataUrl = data?.mockups?.[String(linha)]?.[tipo]
  if (!dataUrl) return null
  const m = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl)
  if (!m) return null
  return { mime: m[1], bytes: Buffer.from(m[2], 'base64') }
}
