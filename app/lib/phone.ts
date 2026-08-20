/**
 * Normaliza um número de WhatsApp para o formato E.164 brasileiro sem o '+':
 * sempre 55 (DDI) + DDD (2 dígitos) + número (8 ou 9 dígitos).
 * Exemplos de entrada aceitos: "81982659521", "081982659521", "5581982659521",
 * "(81) 9 8265-9521", "+55 81 98265-9521".
 */
export function normalizarWhatsApp(input: string): string {
  let digits = input.replace(/\D/g, '')

  if (!digits) return ''

  // Remove '0' inicial de discagem nacional (ex: 081...)
  if (digits.startsWith('0')) {
    digits = digits.slice(1)
  }

  // Um número brasileiro escrito localmente tem 10 dígitos (fixo: DDD + 8) ou
  // 11 (celular: DDD + 9 + 8). Nesse tamanho ele NUNCA carrega DDI, então
  // prefixa sempre — sem perguntar como começa.
  //
  // Por que a pergunta era errada: o teste anterior era só
  // `if (!digits.startsWith('55'))`, e isso quebra o **DDD 55** (Santa Maria e
  // região, no RS), que colide com o código do país. Um celular de lá escrito
  // como "55999667936" (11 dígitos) era lido como "já tem DDI" e voltava com
  // 11 dígitos — número inválido, wa.me não abre e a Z-API não entrega.
  // Encontrado em 20/08/2026 num cliente real de pedidos_assistente.
  if (digits.length <= 11) {
    return '55' + digits
  }

  // Daqui pra cima (12+) só falta o DDI quando ele realmente não está lá.
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

/**
 * Valida se o input é um número de WhatsApp brasileiro válido (celular).
 *
 * Regras:
 * - Após normalizar pra E.164 BR (55+DDD+9+8díg), deve ter exatamente 13 dígitos
 * - O dígito após DDD precisa ser '9' (celular brasileiro com 9 obrigatório)
 *
 * Não valida se o número existe de fato; só formato.
 */
export function validarWhatsApp(input: string): boolean {
  if (!input || typeof input !== 'string') return false
  const digits = normalizarWhatsApp(input)
  return digits.length === 13 && digits[4] === '9'
}

/**
 * Gera link wa.me com texto opcional pré-preenchido.
 * WhatsApp renderiza o link como clicável nas mensagens.
 *
 * Usa `variantesWhatsApp(...)[0]`, e não `normalizarWhatsApp` direto, porque a
 * primeira variante é sempre a **canônica de 13 dígitos**: quando o número
 * chega com 12 (DDD + 8 dígitos, celular cadastrado antes de o nono dígito
 * virar obrigatório no Brasil), ela completa o 9. O wa.me não resolve a forma
 * curta — abre "número inválido" — e havia 4 desses em pedidos_assistente em
 * 20/08/2026, todos em pedidos já aceitos.
 *
 * Fixo continua intacto: em `variantesWhatsApp` o 9 só entra quando o primeiro
 * dígito do assinante é 6–9, faixa de celular.
 */
export function linkWhatsApp(numero: string, mensagem?: string): string {
  const n = variantesWhatsApp(numero)[0]
  const base = `https://wa.me/${n}`
  return mensagem ? `${base}?text=${encodeURIComponent(mensagem)}` : base
}
