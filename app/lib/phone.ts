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

/**
 * Retorna todas as variações possíveis de um número de WhatsApp brasileiro.
 *
 * A Z-API é inconsistente: envia mensagens para o número com 13 dígitos
 * (55 + DDD + 9 + 8 dígitos), mas o webhook de resposta retorna o número com
 * 12 dígitos (55 + DDD + 8 dígitos, sem o 9º dígito do celular). Sem isso, o
 * webhook não acha o lead cadastrado com o número canônico de 13 dígitos.
 *
 * Para celulares (primeiro dígito após DDD é 9 na forma de 13 dígitos), retorna
 * ambas as variantes: [canônica com 13 dígitos, reduzida com 12 dígitos].
 * Para fixos (10 dígitos sem DDI), retorna array com só a versão normalizada.
 */
export function variantesWhatsApp(input: string): string[] {
  const digits = normalizarWhatsApp(input)

  // 13 dígitos: 55 + DDD(2) + 9 + subscriber(8) → celular com 9
  if (digits.length === 13 && digits[4] === '9') {
    const sem9 = digits.slice(0, 4) + digits.slice(5)
    return [digits, sem9]
  }

  // 12 dígitos: 55 + DDD(2) + subscriber(8) → celular sem o 9 (primeiro dígito ≥ 6)
  if (digits.length === 12 && parseInt(digits[4]) >= 6) {
    const com9 = digits.slice(0, 4) + '9' + digits.slice(4)
    return [com9, digits]
  }

  return [digits]
}
