// app/lib/admin-fornecedor-ofertas.ts
// ============================================================================
// O HISTÓRICO DE OFERTAS DE UMA CONFECÇÃO, DAS DUAS ERAS — 29/09/2026.
//
// O painel do fornecedor (/admin/fornecedores → Detalhes) lia só `ofertas` +
// `pedidos`, as tabelas do fluxo antigo das páginas de produto. A última
// oferta por esse caminho é de maio. Desde então tudo passa por
// `ofertas_pedido_assistente` + `pedidos_assistente` — e o card mostrava
// "última oferta: 4 meses atrás" pra Keylla, que tinha recebido oferta na
// manhã do mesmo dia. O Fernando: "tô achando que esse card não está
// contabilizando há algum tempo".
//
// Aqui as duas fontes viram UMA lista com a mesma forma, e as duas rotas
// (métricas e tabela) leem daqui. Vocabulário normalizado pro que a tela já
// entende:
//   enviada  = ainda sem resposta (nova: 'ofertada' dentro do prazo)
//   aceita / recusada = ela respondeu
//   expirada = venceu sem resposta, ou o pedido fechou com outra (nova:
//              'cancelada' — o "Fechou com outro" fica na coluna do pedido)
// ============================================================================

import { supabaseAdmin } from './supabase-server'

export type OfertaNormalizada = {
  id: string
  origem: 'legado' | 'assistente'
  status: 'enviada' | 'aceita' | 'recusada' | 'expirada'
  enviada_em: string | null
  respondida_em: string | null
  tentativa_numero: number | null
  tempo_resposta_ms: number | null
  pedido: {
    id: string
    codigo: string | null
    tipo: string
    quantidade: number | null
    estado: string | null
    prazo: string | null
    status: string
    criado_em: string
    fornecedor_aceito_id: string | null
  } | null
}

function tempoResposta(enviada: string | null, respondida: string | null): number | null {
  if (!enviada || !respondida) return null
  const d = new Date(respondida).getTime() - new Date(enviada).getTime()
  return d >= 0 ? d : null
}

function totalDasLinhas(linhas: unknown): number | null {
  if (!Array.isArray(linhas) || linhas.length === 0) return null
  let soma = 0
  for (const l of linhas as Array<{ total?: unknown; tamanhos?: Array<{ qtd?: unknown }> | null }>) {
    if (typeof l.total === 'number' && l.total > 0) soma += l.total
    else soma += (l.tamanhos ?? []).reduce((s, t) => s + (typeof t.qtd === 'number' ? t.qtd : 0), 0)
  }
  return soma > 0 ? soma : null
}

async function legado(fornecedorId: string): Promise<OfertaNormalizada[]> {
  const { data, error } = await supabaseAdmin
    .from('ofertas')
    .select('id, status, enviada_em, respondida_em, tentativa_numero, pedido:pedidos(id, tipo, quantidade, estado, prazo, status, criado_em, fornecedor_aceito_id)')
    .eq('fornecedor_id', fornecedorId)
  if (error) throw new Error(`ofertas (legado): ${error.message}`)
  type Ped = { id: string; tipo: string; quantidade: number | null; estado: string | null; prazo: string | null; status: string; criado_em: string; fornecedor_aceito_id: string | null }
  type R = { id: string; status: string; enviada_em: string | null; respondida_em: string | null; tentativa_numero: number | null; pedido: Ped | Ped[] | null }
  return ((data ?? []) as unknown as R[]).map((o) => {
    const p = Array.isArray(o.pedido) ? o.pedido[0] : o.pedido
    const status: OfertaNormalizada['status'] =
      o.status === 'aceita' || o.status === 'recusada' || o.status === 'expirada' ? o.status : 'enviada'
    return {
      id: o.id,
      origem: 'legado',
      status,
      enviada_em: o.enviada_em,
      respondida_em: o.respondida_em,
      tentativa_numero: o.tentativa_numero,
      tempo_resposta_ms: status === 'aceita' || status === 'recusada' ? tempoResposta(o.enviada_em, o.respondida_em) : null,
      pedido: p ? { ...p, codigo: null } : null,
    }
  })
}

async function assistente(fornecedorId: string): Promise<OfertaNormalizada[]> {
  const { data, error } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('id, status, criado_em, respondido_em, expira_em, pedido_id, pedidos_assistente(id, codigo, categoria, linhas, uf, prazo_dias, status, criado_em, encerrado_em, pagamento_status)')
    .eq('fornecedor_id', fornecedorId)
  if (error) throw new Error(`ofertas (assistente): ${error.message}`)
  type Ped = { id: string; codigo: string | null; categoria: string | null; linhas: unknown; uf: string | null; prazo_dias: number | null; status: string | null; criado_em: string; encerrado_em: string | null; pagamento_status: string | null }
  type R = { id: string; status: string; criado_em: string; respondido_em: string | null; expira_em: string | null; pedido_id: string; pedidos_assistente: Ped | Ped[] | null }
  const linhas = (data ?? []) as unknown as R[]
  if (linhas.length === 0) return []

  // Quem ficou com cada pedido: a oferta aceita (de qualquer confecção).
  const { data: aceitas, error: e2 } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('pedido_id, fornecedor_id')
    .in('pedido_id', Array.from(new Set(linhas.map((l) => l.pedido_id))))
    .eq('status', 'aceita')
  if (e2) throw new Error(`aceites dos pedidos: ${e2.message}`)
  const aceitoPor = new Map(((aceitas ?? []) as Array<{ pedido_id: string; fornecedor_id: string }>).map((a) => [a.pedido_id, a.fornecedor_id]))

  const agora = Date.now()
  return linhas.map((o) => {
    const p = Array.isArray(o.pedidos_assistente) ? o.pedidos_assistente[0] : o.pedidos_assistente
    let status: OfertaNormalizada['status']
    if (o.status === 'aceita') status = 'aceita'
    else if (o.status === 'recusada') status = 'recusada'
    else if (o.status === 'cancelada') status = 'expirada'
    else status = o.expira_em && new Date(o.expira_em).getTime() < agora ? 'expirada' : 'enviada'
    const modelo = Array.isArray(p?.linhas) ? ((p!.linhas as Array<{ modelo?: string | null }>)[0]?.modelo ?? null) : null
    return {
      id: o.id,
      origem: 'assistente',
      status,
      enviada_em: o.criado_em,
      respondida_em: o.respondido_em,
      tentativa_numero: null,
      tempo_resposta_ms: status === 'aceita' || status === 'recusada' ? tempoResposta(o.criado_em, o.respondido_em) : null,
      pedido: p
        ? {
            id: p.id,
            codigo: p.codigo,
            tipo: (p.categoria?.trim() || modelo || 'Pedido').split(' + ')[0],
            quantidade: totalDasLinhas(p.linhas),
            estado: p.uf,
            prazo: p.prazo_dias ? `${p.prazo_dias} dias` : null,
            status: p.encerrado_em ? 'encerrado' : p.pagamento_status === 'pago' ? 'pago' : (p.status ?? 'aberto'),
            criado_em: p.criado_em,
            fornecedor_aceito_id: aceitoPor.get(o.pedido_id) ?? null,
          }
        : null,
    }
  })
}

/** Todas as ofertas da confecção, das duas eras, mais recente primeiro. */
export async function ofertasDoFornecedor(fornecedorId: string): Promise<OfertaNormalizada[]> {
  const [a, b] = await Promise.all([legado(fornecedorId), assistente(fornecedorId)])
  return [...a, ...b].sort((x, y) => (y.enviada_em ?? '').localeCompare(x.enviada_em ?? ''))
}

export type MetricasFornecedor = {
  ofertas_aceitas: number
  ofertas_recusadas: number
  ofertas_enviadas: number
  ofertas_expiradas: number
  taxa_resposta: number | null
  ultima_oferta_em: string | null
  perdeu_para_outro: number
  tempo_medio_resposta_ms: number | null
  ultima_aceitacao_em: string | null
}

export function metricasDasOfertas(fornecedorId: string, ofertas: OfertaNormalizada[]): MetricasFornecedor {
  let aceitas = 0
  let recusadas = 0
  let expiradas = 0
  let ultimaOferta: string | null = null
  let ultimaAceitacao: string | null = null
  let soma = 0
  let n = 0
  const perdidos = new Set<string>()
  for (const o of ofertas) {
    if (o.status === 'aceita') aceitas++
    else if (o.status === 'recusada') recusadas++
    else if (o.status === 'expirada') expiradas++
    if (o.enviada_em && (!ultimaOferta || o.enviada_em > ultimaOferta)) ultimaOferta = o.enviada_em
    if (o.tempo_resposta_ms != null) {
      soma += o.tempo_resposta_ms
      n++
    }
    if (o.status === 'aceita' && o.respondida_em && (!ultimaAceitacao || o.respondida_em > ultimaAceitacao)) ultimaAceitacao = o.respondida_em
    if (o.pedido?.fornecedor_aceito_id && o.pedido.fornecedor_aceito_id !== fornecedorId) perdidos.add(o.pedido.id)
  }
  const enviadas = ofertas.length
  const denom = enviadas - expiradas
  return {
    ofertas_aceitas: aceitas,
    ofertas_recusadas: recusadas,
    ofertas_enviadas: enviadas,
    ofertas_expiradas: expiradas,
    taxa_resposta: denom > 0 ? (aceitas + recusadas) / denom : null,
    ultima_oferta_em: ultimaOferta,
    perdeu_para_outro: perdidos.size,
    tempo_medio_resposta_ms: n > 0 ? Math.round(soma / n) : null,
    ultima_aceitacao_em: ultimaAceitacao,
  }
}
