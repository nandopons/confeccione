// app/lib/format.ts
// ============================================================================
// Helpers de formatação pra exibição (UI / mensagens / emails).
//
// REGRA: estes helpers são pra TEXTO VISÍVEL. NUNCA usar em links wa.me/,
// chamadas pra Z-API, ou valores salvos no banco — esses precisam do
// número E.164 cru (55+DDD+número).
// ============================================================================

/**
 * Formata WhatsApp BR pra exibição visual.
 *
 * Input:  "5511987654321" (E.164, 13 dígitos celular atual)
 *      ou "551134567890"   (E.164, 12 dígitos fixo/celular antigo)
 * Output: "(11) 98765-4321"  ou  "(11) 3456-7890"
 *
 * Fallback seguro: devolve cru se formato inesperado (estrangeiro,
 * incompleto, etc) — nunca quebra exibição.
 */
export function formatarWhatsappBR(numero: string | null | undefined): string {
  if (!numero) return ''
  const digitos = numero.replace(/\D/g, '')

  // 55 + DDD (2) + número (9 dígitos) = 13 dígitos — celular atual
  if (digitos.length === 13 && digitos.startsWith('55')) {
    const ddd = digitos.slice(2, 4)
    const inicio = digitos.slice(4, 9)
    const fim = digitos.slice(9)
    return `(${ddd}) ${inicio}-${fim}`
  }

  // 55 + DDD (2) + número (8 dígitos) = 12 dígitos — fixo/celular antigo
  if (digitos.length === 12 && digitos.startsWith('55')) {
    const ddd = digitos.slice(2, 4)
    const inicio = digitos.slice(4, 8)
    const fim = digitos.slice(8)
    return `(${ddd}) ${inicio}-${fim}`
  }

  return numero
}
