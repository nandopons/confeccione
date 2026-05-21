// app/lib/nome.ts
// ============================================================================
// Normaliza o nome do cliente pra saudação amigável em mensagens.
// Pega só o PRIMEIRO nome e ajusta a capitalização (Title Case do 1º token).
//
// NÃO inventa acento: a informação de acento que não está no dado não é
// recuperável. "ROGERIO SODRE DA SILVA" → "Rogerio" (sem acento, porque o dado
// veio sem). "ROGÉRIO ..." → "Rogério" (acento preservado por já existir).
// ============================================================================

export function primeiroNome(nome: string | null | undefined): string {
  if (!nome) return ''
  const primeiro = nome.trim().split(/\s+/)[0] ?? ''
  if (primeiro.length === 0) return ''
  return (
    primeiro.charAt(0).toLocaleUpperCase('pt-BR') +
    primeiro.slice(1).toLocaleLowerCase('pt-BR')
  )
}
