// app/lib/listas-externas.ts
// ============================================================================
// "Listas Externas" — coleta de tamanhos/nomes de várias pessoas para um
// pedido, organizada POR MODELO (linha_index). Cada inscrição soma +1 no
// tamanho escolhido; a lista vira a FONTE das quantidades daquele modelo.
// Acesso só via service_role (RLS liga sem policies) — mediado pelas rotas.
// ============================================================================
import type { SupabaseClient } from '@supabase/supabase-js'
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

// Recalcula as quantidades por tamanho da LINHA a partir das inscrições da
// lista e grava de volta no pedido (linhas[linha_index].tamanhos + total).
export async function recomputarLinhaDaLista(
  supabase: SupabaseClient,
  lista: Pick<ListaExterna, 'id' | 'pedido_id' | 'linha_index'>,
): Promise<void> {
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
  const total = tamanhos.reduce((a, t) => a + t.qtd, 0)

  const { data: ped } = await supabase
    .from('pedidos_assistente')
    .select('linhas')
    .eq('id', lista.pedido_id)
    .single()
  const linhas = Array.isArray(ped?.linhas) ? [...(ped!.linhas as Record<string, unknown>[])] : []
  if (!linhas[lista.linha_index]) return
  linhas[lista.linha_index] = { ...linhas[lista.linha_index], tamanhos, total }
  await supabase
    .from('pedidos_assistente')
    .update({ linhas, atualizado_em: new Date().toISOString() })
    .eq('id', lista.pedido_id)
}
