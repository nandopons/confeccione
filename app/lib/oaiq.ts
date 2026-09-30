// app/lib/oaiq.ts
// ============================================================================
// PIXEL DE MEDIÇÃO DO CHATGPT ADS (OpenAI Ads Manager) — 30/09/2026.
//
// "Coloca a conversão pra contabilizar quando o cliente fizer o pedido no site
// e quando for chamar no WhatsApp — estilo contabiliza no Google Ads."
// (Fernando.) O Google Ads mede pelo GTM (dataLayer: generate_lead,
// contato_whatsapp, confirmar_pedido, iniciar_pagamento). O pixel da OpenAI
// não passa pelo GTM: é um SDK próprio (oaiq) carregado no layout, e cada
// conversão é uma chamada `oaiq("measure", …)` feita NOS MESMOS PONTOS em que
// o dataLayer recebe o evento do Google — um lugar por conversão, os dois
// medidores juntos.
//
// Mapa (nome no Ads Manager → quando dispara):
//   lead_created     (padrão)  → pedido salvo no site (PedidoSteps e PedidoAssistente)
//   whatsapp_click   (custom)  → clique no botão de WhatsApp com o pedido (PedidoSteps)
//                                 e "Fazer pedido no WhatsApp" da vitrine
//   checkout_started (padrão)  → cliente confirmou o pedido no visualizador
//   order_created    (padrão)  → cobrança Pix gerada ("Pagar agora"), com o valor
//
// `event_id` é o id do pedido: se um dia a mesma conversão for mandada também
// pelo servidor (Conversions API), o pixel e o servidor deduplicam por ele.
//
// Sem NEXT_PUBLIC_OAIQ_PIXEL_ID o SDK não é carregado e cada chamada vira
// no-op — analytics nunca quebra o fluxo. Docs:
// https://developers.openai.com/ads/measurement-pixel
// ============================================================================

export const OAIQ_PIXEL_ID = (process.env.NEXT_PUBLIC_OAIQ_PIXEL_ID ?? '').trim()

/** O snippet oficial, com o Pixel ID desta conta. Vai no <head> do layout. */
export function snippetOaiq(pixelId: string): string {
  return (
    '(function(w,d,s,u){if(w.oaiq)return;var q=function(){q.q.push(arguments)};q.q=[];w.oaiq=q;' +
    'var js=d.createElement(s);js.async=true;js.src=u;var f=d.getElementsByTagName(s)[0];f.parentNode.insertBefore(js,f);})' +
    '(window,document,"script","https://bzrcdn.openai.com/sdk/oaiq.min.js");' +
    `oaiq("init",{pixelId:${JSON.stringify(pixelId)}});`
  )
}

type Oaiq = (...args: unknown[]) => void

function chamar(...args: unknown[]): void {
  if (typeof window === 'undefined') return
  const w = window as unknown as { oaiq?: Oaiq }
  if (typeof w.oaiq !== 'function') return
  try {
    w.oaiq(...args)
  } catch {
    /* analytics nunca quebra o fluxo */
  }
}

/** Pedido salvo no site — a conversão principal da campanha (lead). */
export function medirPedidoCriado(pedidoId: string): void {
  chamar('measure', 'lead_created', { type: 'customer_action' }, { event_id: `lead_${pedidoId}` })
}

/** Cliente clicou pra falar no WhatsApp (com o pedido ou pela vitrine). */
export function medirCliqueWhatsApp(referencia: string): void {
  chamar('measure', 'custom', { type: 'custom' }, { custom_event_name: 'whatsapp_click', event_id: `wa_${referencia}` })
}

/** Cliente confirmou o pedido no visualizador (vai pras confecções). */
export function medirPedidoConfirmado(pedidoId: string, valorCentavos?: number | null): void {
  const dados: Record<string, unknown> = { type: 'contents' }
  if (typeof valorCentavos === 'number' && valorCentavos > 0) {
    dados.amount = Math.round(valorCentavos)
    dados.currency = 'BRL'
  }
  chamar('measure', 'checkout_started', dados, { event_id: `confirmacao_${pedidoId}` })
}

/** Cobrança gerada ("Pagar agora") — o mais perto de venda que o site mede. */
export function medirPagamentoIniciado(pedidoId: string, valorCentavos?: number | null): void {
  const dados: Record<string, unknown> = { type: 'contents' }
  if (typeof valorCentavos === 'number' && valorCentavos > 0) {
    dados.amount = Math.round(valorCentavos)
    dados.currency = 'BRL'
  }
  chamar('measure', 'order_created', dados, { event_id: `pagamento_${pedidoId}` })
}
