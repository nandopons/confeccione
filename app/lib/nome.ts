// app/lib/nome.ts
// ============================================================================
// Normaliza o nome do cliente pra saudação amigável em mensagens.
// Pega só o PRIMEIRO nome e ajusta a capitalização (Title Case do 1º token).
//
// NÃO inventa acento: a informação de acento que não está no dado não é
// recuperável. "ROGERIO SODRE DA SILVA" → "Rogerio" (sem acento, porque o dado
// veio sem). "ROGÉRIO ..." → "Rogério" (acento preservado por já existir).
// ============================================================================

/**
 * Palavras que ficam minúsculas no meio do nome. "Maria Eduarda De Deus
 * Rodrigues" está tão errado quanto "maria eduarda de deus rodrigues" — o
 * primeiro parece cadastro de sistema, o segundo parece desleixo.
 */
const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'del', 'di', 'van', 'von'])

/**
 * Nome próprio no padrão, pra gravar no cadastro e mostrar nas telas.
 *
 * O nome chega do jeito que a pessoa digitou ou do perfil do WhatsApp: tudo
 * minúsculo, TUDO MAIÚSCULO, ou misturado. Quem lê o inbox e quem recebe a
 * mensagem vê isso, e "nicole" ou "JOAQUIM LIMA RABELO" passa a impressão de
 * base bagunçada.
 *
 * Como primeiroNome, NÃO inventa acento: o que veio sem acento continua sem.
 * Também preserva o que já está bem escrito — se o nome tem maiúsculas e
 * minúsculas misturadas de propósito (McDonald, iPhone), não mexe.
 */
export function nomeProprio(nome: string | null | undefined): string {
  if (!nome) return ''
  const limpo = nome.trim().replace(/\s+/g, ' ')
  if (!limpo) return ''

  const todoMinusculo = limpo === limpo.toLocaleLowerCase('pt-BR')
  const todoMaiusculo = limpo === limpo.toLocaleUpperCase('pt-BR')
  // Já está em capitalização mista: é escolha de quem escreveu, não mexe.
  if (!todoMinusculo && !todoMaiusculo) return limpo

  return limpo
    .split(' ')
    .map((palavra, i) => {
      const baixo = palavra.toLocaleLowerCase('pt-BR')
      if (i > 0 && PARTICULAS.has(baixo)) return baixo
      return baixo.charAt(0).toLocaleUpperCase('pt-BR') + baixo.slice(1)
    })
    .join(' ')
}

export function primeiroNome(nome: string | null | undefined): string {
  if (!nome) return ''
  const primeiro = nome.trim().split(/\s+/)[0] ?? ''
  if (primeiro.length === 0) return ''
  return (
    primeiro.charAt(0).toLocaleUpperCase('pt-BR') +
    primeiro.slice(1).toLocaleLowerCase('pt-BR')
  )
}
