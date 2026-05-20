// app/lib/arquivos-format.ts
// ============================================================================
// Helpers PUROS de formatação de arquivos (sem side-effects nem Supabase) —
// seguros pra importar tanto em Server quanto em Client Components.
// ============================================================================

export const EXTENSOES_IMAGEM = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']

/**
 * Separa nome em base + extensão (com o ponto). Sem extensão (ou ponto inicial
 * tipo ".gitignore") → ext vazia.
 */
export function splitExtensao(nome: string): { base: string; ext: string } {
  const idx = nome.lastIndexOf('.')
  if (idx <= 0) return { base: nome, ext: '' }
  return { base: nome.slice(0, idx), ext: nome.slice(idx) }
}

/** Junta base (trim) + extensão preservada. */
export function reunirNome(base: string, ext: string): string {
  return base.trim() + ext
}

/** True se o nome tem extensão de imagem suportada (case-insensitive). */
export function ehImagem(nome: string): boolean {
  const { ext } = splitExtensao(nome)
  return EXTENSOES_IMAGEM.includes(ext.toLowerCase())
}

/** Rótulo curto da extensão pra ícone (ex: "PDF", "ZIP"). Sem ext → "ARQ". */
export function extensaoLabel(nome: string): string {
  const { ext } = splitExtensao(nome)
  return ext ? ext.slice(1).toUpperCase() : 'ARQ'
}

export function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
