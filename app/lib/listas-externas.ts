// app/lib/listas-externas.ts
// ============================================================================
// "Listas Externas" — coleta de tamanhos/nomes de várias pessoas para um
// pedido, organizada POR MODELO (linha_index). Cada inscrição soma +1 no
// tamanho escolhido; a lista vira a FONTE das quantidades daquele modelo.
// Acesso só via service_role (RLS liga sem policies) — mediado pelas rotas.
// ============================================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { SITE_URL } from './url'

export type ListaExterna = {
  id: string
  pedido_id: string
  linha_index: number
  modelo_nome: string | null
  cor: string | null
  titulo: string | null
  token: string
  ativa: boolean
  criado_em: string
  lid?: string | null
}

export type InscricaoExterna = {
  id: string
  lista_id: string
  pedido_id: string
  nome: string
  tamanho: string
  numero: string | null
  observacao: string | null
  whatsapp: string | null
  email: string | null
  criado_em: string
}

export function linkInscricaoUrl(token: string): string {
  return `${SITE_URL}/inscricao/${token}`
}

// ordem lógica de tamanhos (mesma régua do visualizador)
const ORDEM = ['PP', 'P', 'M', 'G', 'GG', 'XG', 'XGG', 'XXG', 'EXG']
function ordemTam(t: string): number {
  const u = (t || '').toUpperCase().trim()
  const i = ORDEM.indexOf(u)
  if (i >= 0) return i
  // tamanhos numéricos (ex.: "2", "14") vão pro fim, em ordem numérica
  const n = parseInt(u, 10)
  if (!isNaN(n)) return 100 + n
  return 90
}

// Quantidade-alvo da linha = a quantidade já definida no pedido pra aquele
// modelo. Quando há alvo (>0), a lista PREENCHE até ele e só "assume" os
// tamanhos do modelo quando completa (atinge o alvo) — antes disso o pedido
// mantém o breakdown original. Sem alvo (0), a lista é a fonte (legado).
export function metaQtdLinha(linha: { total?: number | null } | undefined | null): number {
  const t = linha?.total
  return typeof t === 'number' && t > 0 ? Math.round(t) : 0
}

// Recalcula as quantidades por tamanho da LINHA a partir das inscrições da
// lista e grava de volta no pedido (linhas[linha_index].tamanhos + total).
export function novoLid(): string {
  return crypto.randomBytes(8).toString('hex')
}

// Garante que a linha do índice tenha um lid estável; persiste se faltava.
export async function garantirLidLinha(
  supabase: SupabaseClient,
  pedido_id: string,
  idx: number,
): Promise<string | null> {
  const { data: ped } = await supabase.from('pedidos_assistente').select('linhas').eq('id', pedido_id).single()
  const linhas = Array.isArray(ped?.linhas) ? [...(ped!.linhas as Record<string, unknown>[])] : []
  const l = linhas[idx] as { lid?: string } | undefined
  if (!l) return null
  if (typeof l.lid === 'string' && l.lid) return l.lid
  const lid = novoLid()
  linhas[idx] = { ...l, lid }
  await supabase.from('pedidos_assistente').update({ linhas, atualizado_em: new Date().toISOString() }).eq('id', pedido_id)
  return lid
}

// Resolve o índice ATUAL do modelo de uma lista pelo lid (estável), e mantém
// lista.linha_index/lid em dia. Retorna -1 quando o modelo foi excluído
// (órfã) — nesse caso NÃO se deve escrever em índice nenhum.
export async function resolverIndiceDaLista(
  supabase: SupabaseClient,
  lista: { id: string; pedido_id: string; linha_index: number; lid?: string | null },
): Promise<number> {
  const { data: ped } = await supabase.from('pedidos_assistente').select('linhas').eq('id', lista.pedido_id).single()
  const linhas = Array.isArray(ped?.linhas) ? (ped!.linhas as { lid?: string }[]) : []

  // Lista legada (sem lid): adota o lid da linha no índice atual (ou cria um) e migra.
  if (!lista.lid) {
    const l = linhas[lista.linha_index] as { lid?: string } | undefined
    if (!l) return -1
    let lid = typeof l.lid === 'string' && l.lid ? l.lid : null
    if (!lid) {
      lid = novoLid()
      const novas = [...linhas]
      novas[lista.linha_index] = { ...l, lid }
      await supabase.from('pedidos_assistente').update({ linhas: novas, atualizado_em: new Date().toISOString() }).eq('id', lista.pedido_id)
    }
    await supabase.from('listas_externas').update({ lid, atualizado_em: new Date().toISOString() }).eq('id', lista.id)
    lista.lid = lid
    return lista.linha_index
  }

  // Lista com lid: acha a posição atual do modelo.
  const idx = linhas.findIndex((l) => l && l.lid === lista.lid)
  if (idx < 0) return -1 // modelo excluído — órfã
  if (idx !== lista.linha_index) {
    await supabase.from('listas_externas').update({ linha_index: idx, atualizado_em: new Date().toISOString() }).eq('id', lista.id)
    lista.linha_index = idx
  }
  return idx
}

export async function recomputarLinhaDaLista(
  supabase: SupabaseClient,
  lista: Pick<ListaExterna, 'id' | 'pedido_id' | 'linha_index'> & { lid?: string | null },
): Promise<void> {
  // Acha o modelo pelo lid (estável). Se o modelo foi excluído, não escreve.
  const idx = await resolverIndiceDaLista(supabase, lista)
  if (idx < 0) return

  const { data: insc } = await supabase
    .from('inscricoes_externas')
    .select('tamanho')
    .eq('lista_id', lista.id)

  const cont = new Map<string, number>()
  for (const r of insc ?? []) {
    const tam = String((r as { tamanho: string }).tamanho || '').toUpperCase().trim()
    if (!tam) continue
    cont.set(tam, (cont.get(tam) ?? 0) + 1)
  }
  const tamanhos = Array.from(cont.entries())
    .map(([tamanho, qtd]) => ({ tamanho, qtd }))
    .sort((a, b) => ordemTam(a.tamanho) - ordemTam(b.tamanho))
  const coletado = tamanhos.reduce((a, t) => a + t.qtd, 0)

  const { data: ped } = await supabase
    .from('pedidos_assistente')
    .select('linhas')
    .eq('id', lista.pedido_id)
    .single()
  const linhas = Array.isArray(ped?.linhas) ? [...(ped!.linhas as Record<string, unknown>[])] : []
  if (!linhas[idx]) return

  const meta = metaQtdLinha(linhas[idx] as { total?: number | null })

  // COM alvo: a lista só "assume" os tamanhos do modelo quando COMPLETA (o nº
  // de inscritos atinge o alvo). Enquanto incompleta, NÃO mexe na linha — o
  // pedido mantém o breakdown original e o total-alvo fica intacto. Ao
  // completar, grava os tamanhos coletados (total continua = alvo) e fecha a
  // lista (ativa=false), pra a quantidade não mudar mais depois.
  if (meta > 0) {
    if (coletado < meta) return // incompleta → não altera a linha
    linhas[idx] = { ...linhas[idx], tamanhos, total: meta }
    await supabase
      .from('pedidos_assistente')
      .update({ linhas, atualizado_em: new Date().toISOString() })
      .eq('id', lista.pedido_id)
    await supabase
      .from('listas_externas')
      .update({ ativa: false, atualizado_em: new Date().toISOString() })
      .eq('id', lista.id)
    return
  }

  // SEM alvo (coleta pura, legado): a lista é a fonte das quantidades.
  linhas[idx] = { ...linhas[idx], tamanhos, total: coletado }
  await supabase
    .from('pedidos_assistente')
    .update({ linhas, atualizado_em: new Date().toISOString() })
    .eq('id', lista.pedido_id)
}

// True se o pedido tem ALGUMA lista ativa ainda incompleta (inscritos < alvo).
// Usado pra avisar o fornecedor que as quantidades de tamanho podem mudar.
// Recebe as linhas do pedido (pra ler alvo e casar lid → índice atual).
export async function pedidoTemListaAbertaIncompleta(
  supabase: SupabaseClient,
  pedidoId: string,
  linhas: { total?: number | null; lid?: string | null }[],
): Promise<boolean> {
  const { data: listas } = await supabase
    .from('listas_externas')
    .select('id, linha_index, lid, ativa')
    .eq('pedido_id', pedidoId)
    .eq('ativa', true)
  for (const l of (listas ?? []) as { id: string; linha_index: number; lid?: string | null }[]) {
    let idx = l.linha_index
    if (l.lid) {
      const j = linhas.findIndex((x) => x && (x as { lid?: string | null }).lid === l.lid)
      if (j >= 0) idx = j
    }
    const meta = metaQtdLinha(linhas[idx])
    if (meta <= 0) continue // coleta pura sem alvo: não gera aviso de "muda qtd"
    const { count } = await supabase
      .from('inscricoes_externas')
      .select('id', { count: 'exact', head: true })
      .eq('lista_id', l.id)
    if ((count ?? 0) < meta) return true
  }
  return false
}
