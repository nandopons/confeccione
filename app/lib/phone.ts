/**
 * Normaliza um número de WhatsApp para o formato E.164 brasileiro sem o '+':
 * sempre 55 (DDI) + DDD (2 dígitos) + número (8 ou 9 dígitos).
 * Exemplos de entrada aceitos: "81982659521", "081982659521", "5581982659521",
 * "(81) 9 8265-9521", "+55 81 98265-9521".
 */
export function normalizarWhatsApp(input: string): string {
  let digits = input.replace(/\D/g, '')

  // Remove '0' inicial de discagem nacional (ex: 081...)
  if (digits.startsWith('0')) {
    digits = digits.slice(1)
  }

  // Adiciona DDI 55 se ainda não estiver presente
  if (!digits.startsWith('55')) {
    digits = '55' + digits
  }

  return digits
}
