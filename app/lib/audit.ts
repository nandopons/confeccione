/**
 * Audit log — registra ações administrativas. Insert é "fire-and-forget" do
 * ponto de vista do caller: se falhar, loga e segue. Audit não deve quebrar
 * a ação principal.
 *
 * Convenção de `acao`: <entidade>.<verbo>  ex: 'fornecedor.pausar'
 * Validado por CHECK no banco: '^[a-z_]+\.[a-z_]+$'
 */

import { supabaseAdmin } from '@/app/lib/supabase-server'

export type Mudancas = Record<string, { de: unknown; para: unknown }>

export interface RegistrarAuditInput {
  ator: string
  acao: string
  entidade_tipo: string
  entidade_id?: string | null
  mudancas?: Mudancas | null
  metadata?: Record<string, unknown> | null
}

export async function registrarAudit(input: RegistrarAuditInput): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from('audit_log').insert({
      ator: input.ator,
      acao: input.acao,
      entidade_tipo: input.entidade_tipo,
      entidade_id: input.entidade_id ?? null,
      mudancas: input.mudancas ?? null,
      metadata: input.metadata ?? null,
    })
    if (error) {
      console.error('[audit] erro ao inserir:', error.message, { input })
    }
  } catch (e) {
    console.error('[audit] exception:', e, { input })
  }
}

/**
 * Compara antes/depois e devolve só os campos que mudaram, no formato
 * { campo: { de, para } } pronto pra gravar em audit_log.mudancas.
 */
export function diffMudancas<T extends Record<string, unknown>>(
  antes: Partial<T>,
  depois: Partial<T>,
): Mudancas {
  const out: Mudancas = {}
  const chaves = new Set([...Object.keys(antes), ...Object.keys(depois)])
  for (const k of chaves) {
    const a = antes[k]
    const b = depois[k]
    if (!iguais(a, b)) out[k] = { de: a ?? null, para: b ?? null }
  }
  return out
}

function iguais(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    const sa = [...a].map(String).sort()
    const sb = [...b].map(String).sort()
    return sa.every((v, i) => v === sb[i])
  }
  return false
}
