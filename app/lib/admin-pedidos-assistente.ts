// app/lib/admin-pedidos-assistente.ts
// Admin: lista e detalha os pedidos do fluxo de chat (pedidos_assistente),
// com foco nos NÃO concluídos (não pagos), pra revisar conversa + mockups/artes.
import { supabaseAdmin } from './supabase-server'
import { enviarMensagem } from './zapi'
import { SITE_URL } from './url'
import { emailFeedbackMockup } from './email'
import { mensagemReativacao, registrarContato } from './marketing-contatos'

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
  ofertaStatus: 'aceita' | 'ofertada' | null
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
  const lista = (data ?? []) as any[]
  // status de oferta por pedido (pra rotular 'buscando fornecedor' / 'aceito')
  const ofertaPorPedido = new Map<string, 'aceita' | 'ofertada'>()
  const ids = lista.map((p) => p.id)
  if (ids.length > 0) {
    const { data: ofs } = await supabaseAdmin
      .from('ofertas_pedido_assistente')
      .select('pedido_id, status')
      .in('pedido_id', ids)
    for (const o of (ofs ?? []) as any[]) {
      const atual = ofertaPorPedido.get(o.pedido_id)
      if (o.status === 'aceita') ofertaPorPedido.set(o.pedido_id, 'aceita')
      else if (o.status === 'ofertada' && atual !== 'aceita') ofertaPorPedido.set(o.pedido_id, 'ofertada')
    }
  }
  return lista.map((p) => {
    const linhas = Array.isArray(p.linhas) ? (p.linhas as LinhaJson[]) : []
    const { totalPecas, resumo } = totalEResumo(linhas)
    return {
      id: p.id, criadoEm: p.criado_em, nome: p.nome, telefone: p.telefone, email: p.email,
      status: p.status, pagamentoStatus: p.pagamento_status, valorCentavos: p.valor_centavos,
      totalPecas, resumo, concluido: p.pagamento_status === 'pago',
      ofertaStatus: ofertaPorPedido.get(p.id) ?? null,
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

// ---------------------------------------------------------------------------
// Ações do admin sobre um pedido do chat: excluir, lembrete, pedir feedback.
// Todo envio bem-sucedido fica registrado em contatos_marketing (histórico).
// ---------------------------------------------------------------------------
export type AcaoPedidoChat = 'excluir' | 'lembrete' | 'feedback'

export async function acaoPedidoChat(id: string, acao: AcaoPedidoChat): Promise<{ ok: boolean; erro?: string; whats?: boolean; email?: boolean }> {
  const { data: p } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, nome, telefone, email')
    .eq('id', id)
    .maybeSingle<{ id: string; nome: string | null; telefone: string | null; email: string | null }>()
  if (!p) return { ok: false, erro: 'Pedido não encontrado' }

  if (acao === 'excluir') {
    const { error } = await supabaseAdmin.from('pedidos_assistente').delete().eq('id', id)
    if (error) return { ok: false, erro: error.message }
    return { ok: true }
  }

  const link = `${SITE_URL}/visualizador/${id}`
  let whats = false
  let email = false

  // Lembrete = mensagem SIMPLES de reativação, sem link (o link vai manualmente
  // depois que o cliente responder). Feedback continua com link.
  const msg =
    acao === 'lembrete'
      ? mensagemReativacao(p.nome)
      : `Oi${p.nome ? ' ' + p.nome.split(' ')[0] : ''}! 👀 O mockup ficou como você queria? Dá uma olhada e, se precisar mudar algo (posição da arte, tamanho, cor…), use o botão "Ajustar detalhe" na peça que a gente atualiza na hora:\n${link}`

  if (p.telefone) {
    try { whats = await enviarMensagem(p.telefone, msg) } catch { whats = false }
    if (whats) {
      try { await registrarContato(id, { tipo: acao, origem: 'manual', mensagem: msg }) } catch { /* histórico não bloqueia */ }
    }
  }
  if (p.email && acao === 'feedback') {
    try {
      await emailFeedbackMockup({ email: p.email, nome: p.nome, link })
      email = true
    } catch { email = false }
  }
  return { ok: true, whats, email }
}
