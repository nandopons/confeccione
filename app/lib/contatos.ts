// app/lib/contatos.ts
// ============================================================================
// Constantes de contato público (suporte, redes sociais, etc).
// Centralizadas aqui pra evitar hardcode espalhado pelo código.
// ============================================================================

/**
 * WhatsApp de suporte público da Confeccione.
 * Formato E.164 sem o "+", pronto pra concatenar em https://wa.me/{numero}.
 * Apresentação visual: (81) 99578-2077.
 */
export const WHATSAPP_SUPORTE = "5581995782077"

/**
 * Versão formatada pra exibição (com parênteses e hífen).
 * Use em texto visível pro usuário.
 */
export const WHATSAPP_SUPORTE_FORMATADO = "(81) 99578-2077"

/**
 * Helper que monta link wa.me opcionalmente com mensagem pré-preenchida.
 * @param mensagem texto puro; será URL-encoded.
 */
export function linkWhatsAppSuporte(mensagem?: string): string {
  const base = `https://wa.me/${WHATSAPP_SUPORTE}`
  if (!mensagem) return base
  return `${base}?text=${encodeURIComponent(mensagem)}`
}
