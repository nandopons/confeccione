// app/lib/url.ts
// ============================================================================
// URL base canônica do site + helpers de links pro painel do cliente.
//
// SITE_URL vem de NEXT_PUBLIC_SITE_URL (definido no .env.local e na Vercel).
// Fallback é o domínio de produção. Use SEMPRE estes helpers em mensagens
// (WhatsApp/email) — nunca derive a URL do request (req.nextUrl.origin),
// senão links em preview/local apontam pro lugar errado.
// ============================================================================

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://confeccione.com.br'

export function painelClienteUrl(): string {
  return `${SITE_URL}/cliente/login`
}

export function painelClientePedidoUrl(pedidoId: string): string {
  return `${SITE_URL}/cliente/pedido/${pedidoId}`
}

export function loginComEmailUrl(email: string): string {
  return `${SITE_URL}/cliente/login?email=${encodeURIComponent(email)}`
}

export function ofertaFornecedorUrl(ofertaId: string): string {
  return `${SITE_URL}/fornecedor/oferta/${ofertaId}`
}
