// app/lib/engajamento-fornecedor.ts
// ============================================================================
// QUEM RESPONDE SOBE, QUEM IGNORA DESCE — 29/09/2026 (decisão do Fernando)
//
// Medido nos 60 dias até 29/09: 176 ofertas, 32% aceitas — e 63% desses
// aceites são de UMA confecção (Dom Santo). 16% das ofertas venceram sem
// resposta nenhuma, sempre das mesmas: Big Uniformes (5 de 5), Comprov (3 de
// 3), silvia rodrigues (4), Atelier Neuzi (7 ofertas, uma mensagem). Enquanto
// isso Joaquim (6 aceites em 8), Conquisst (responde em 20 min), JULS (6 min)
// recebiam pouca oferta, porque o match só olhava cidade e peça.
//
// O Fernando: "focar em quem interage mais e deixar pra ir testando interação
// com os que não interagem, até realmente deixar eles bem pro fundo".
//
// Então o histórico entra no match como uma camada por cima de geografia e
// peça (que continuam mandando — confecção certa do lugar certo ainda vale
// mais que confecção rápida do lugar errado):
//   • respondeu (aceitou ou recusou) a maioria do que recebeu → sobe
//   • responde rápido → sobe um pouco mais
//   • deixou ofertas vencerem sem responder → desce, e cada nova ignorada
//     desce mais, até o fundo (teto de desconto)
//   • nunca recebeu oferta → neutro: é o "ir testando" — ela entra na vez
//     dela, sem vantagem e sem castigo
//
// "Ignorou" é só o que ela deixou vencer: oferta que outra confecção levou
// antes, ou pedido que o cliente cancelou, não conta contra ninguém.
// ============================================================================

import { supabaseAdmin } from './supabase-server'

/** Quanto de história olhar. Confecção muda; o que ela fez em maio não descreve setembro. */
const DIAS_DE_HISTORICO = 90

export type Engajamento = {
  /** Ofertas que ela respondeu (aceitou ou recusou). */
  respondidas: number
  /** Ofertas que venceram sem resposta (nem outra levou, nem o pedido morreu). */
  ignoradas: number
  /** Tempo médio até responder, em horas, quando respondeu. */
  horasResposta: number | null
}

type Linha = {
  fornecedor_id: string
  pedido_id: string
  status: string
  criado_em: string
  respondido_em: string | null
  expira_em: string | null
}

/**
 * O engajamento de cada confecção da lista, calculado do zero a cada chamada.
 * Barato: uma consulta em ofertas dos últimos 90 dias (centenas de linhas) e
 * uma em quem aceitou cada pedido. Consulta que falha lança — engajamento
 * "vazio" viraria "todo mundo neutro", e a fila voltaria a ofertar pra quem
 * ignora como se nada tivesse acontecido.
 */
export async function engajamentoDosFornecedores(fornecedorIds: string[]): Promise<Map<string, Engajamento>> {
  const mapa = new Map<string, Engajamento>()
  if (fornecedorIds.length === 0) return mapa
  const desde = new Date(Date.now() - DIAS_DE_HISTORICO * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('fornecedor_id, pedido_id, status, criado_em, respondido_em, expira_em')
    .in('fornecedor_id', fornecedorIds)
    .gte('criado_em', desde)
  if (error) throw new Error(`engajamento: ofertas — ${error.message}`)
  const linhas = (data ?? []) as Linha[]
  if (linhas.length === 0) return mapa

  const pedidoIds = Array.from(new Set(linhas.map((l) => l.pedido_id)))
  const [{ data: aceitas, error: e2 }, { data: mortos, error: e3 }] = await Promise.all([
    supabaseAdmin.from('ofertas_pedido_assistente').select('pedido_id, fornecedor_id').in('pedido_id', pedidoIds).eq('status', 'aceita'),
    supabaseAdmin.from('pedidos_assistente').select('id').in('id', pedidoIds).or('encerrado_em.not.is.null,status.eq.cancelado'),
  ])
  if (e2) throw new Error(`engajamento: aceites — ${e2.message}`)
  if (e3) throw new Error(`engajamento: pedidos encerrados — ${e3.message}`)
  const aceitoPor = new Map<string, Set<string>>()
  for (const a of (aceitas ?? []) as Array<{ pedido_id: string; fornecedor_id: string }>) {
    if (!aceitoPor.has(a.pedido_id)) aceitoPor.set(a.pedido_id, new Set())
    aceitoPor.get(a.pedido_id)!.add(a.fornecedor_id)
  }
  const pedidoMorto = new Set(((mortos ?? []) as Array<{ id: string }>).map((m) => m.id))

  const agora = Date.now()
  const soma = new Map<string, { respondidas: number; ignoradas: number; horas: number; n: number }>()
  for (const l of linhas) {
    const s = soma.get(l.fornecedor_id) ?? { respondidas: 0, ignoradas: 0, horas: 0, n: 0 }
    if (l.status === 'aceita' || l.status === 'recusada') {
      s.respondidas++
      if (l.respondido_em) {
        const h = (new Date(l.respondido_em).getTime() - new Date(l.criado_em).getTime()) / 3_600_000
        if (h >= 0) {
          s.horas += h
          s.n++
        }
      }
    } else {
      const outraLevou = [...(aceitoPor.get(l.pedido_id) ?? [])].some((f) => f !== l.fornecedor_id)
      const venceu = l.status === 'cancelada' || (l.status === 'ofertada' && l.expira_em != null && new Date(l.expira_em).getTime() < agora)
      if (venceu && !outraLevou && !pedidoMorto.has(l.pedido_id)) s.ignoradas++
    }
    soma.set(l.fornecedor_id, s)
  }
  for (const [id, s] of soma) {
    mapa.set(id, { respondidas: s.respondidas, ignoradas: s.ignoradas, horasResposta: s.n > 0 ? s.horas / s.n : null })
  }
  return mapa
}

/** Anexa o engajamento a cada fornecedor da lista (quem não tem histórico fica sem o campo = neutro). */
export async function comEngajamento<T extends { id: string }>(fornecedores: T[]): Promise<Array<T & { engajamento?: Engajamento }>> {
  const mapa = await engajamentoDosFornecedores(fornecedores.map((f) => f.id))
  return fornecedores.map((f) => {
    const e = mapa.get(f.id)
    return e ? { ...f, engajamento: e } : f
  })
}
