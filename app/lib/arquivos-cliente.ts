// app/lib/arquivos-cliente.ts
// ============================================================================
// Helpers do repositório de arquivos do cliente (Sprint 3).
//
// Bucket privado 'artes-clientes'. Quota total de 50MB por conta — único
// limite (sem teto por arquivo, sem whitelist de MIME). Toda a validação de
// quota acontece na aplicação, ANTES de aceitar o upload.
// ============================================================================

import { supabaseAdmin } from '@/app/lib/supabase-server'

export const BUCKET_ARTES = 'artes-clientes'
export const QUOTA_BYTES = 50 * 1024 * 1024 // 52.428.800 (50 MiB)
export const DISPLAY_NAME_MAX = 200

export type ArquivoCliente = {
  id: string
  conta_id: string
  storage_path: string
  display_name: string
  mime_type: string | null
  tamanho_bytes: number
  criado_em: string
  atualizado_em: string
}

/**
 * Sanitiza nome de arquivo pro storage path: tudo que não for [a-zA-Z0-9._-]
 * vira '_'. Garante fallback não-vazio.
 */
export function sanitizeFilename(nome: string): string {
  const limpo = nome.replace(/[^a-zA-Z0-9._-]/g, '_')
  return limpo.length > 0 ? limpo : 'arquivo'
}

/**
 * Normaliza display_name: trim + corta em DISPLAY_NAME_MAX. NÃO sanitiza
 * acentos/emoji (cliente pode usar). Fallback pra 'arquivo' se vazio.
 */
export function normalizarDisplayName(nome: string): string {
  const t = nome.trim().slice(0, DISPLAY_NAME_MAX)
  return t.length > 0 ? t : 'arquivo'
}

/**
 * Lista os arquivos da conta (mais recentes primeiro) e a soma de bytes usados.
 */
export async function listarArquivos(
  contaId: string,
): Promise<{ arquivos: ArquivoCliente[]; usadoBytes: number }> {
  const { data } = await supabaseAdmin
    .from('arquivos_cliente')
    .select(
      'id, conta_id, storage_path, display_name, mime_type, tamanho_bytes, criado_em, atualizado_em',
    )
    .eq('conta_id', contaId)
    .order('criado_em', { ascending: false })

  const arquivos = (data ?? []) as ArquivoCliente[]
  const usadoBytes = arquivos.reduce((acc, a) => acc + (a.tamanho_bytes ?? 0), 0)
  return { arquivos, usadoBytes }
}
