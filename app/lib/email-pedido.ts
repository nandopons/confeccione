// app/lib/email-pedido.ts
// ============================================================================
// E-mail do pedido confirmado: resumo + imagens dos produtos + preço + PIX.
// Envia via Resend (REST). Imagens e QR são referenciados por URL (endpoints
// públicos do pedido) — base64 inline costuma ser bloqueado por clientes.
// ============================================================================

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const FROM = 'Confeccione <contato@confeccione.com.br>'
const SITE = 'https://www.confeccione.com.br'

function brl(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export type LinhaEmail = {
  modelo: string | null
  cor: string | null
  material: string | null
  total: number | null
  tamanhos?: Array<{ tamanho: string; qtd: number | null }>
  estampas?: Array<{ posicao: string; tamanho: string }>
}

export async function enviarEmailPedidoPix(p: {
  id: string
  email: string
  nome: string | null
  totalCentavos: number
  copiaCola: string | null
  invoiceUrl: string
  linhas: LinhaEmail[]
  numImagens: number
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[email-pedido] RESEND_API_KEY ausente — email não enviado')
    return
  }
  if (!p.email || !p.email.includes('@')) return

  const id8 = p.id.slice(0, 8)

  const imagensHtml = Array.from({ length: p.numImagens })
    .map(
      (_, i) =>
        `<tr><td style="padding:6px 0;"><img src="${SITE}/api/pedido/assistente/${p.id}/imagem?i=${i}" alt="produto ${i + 1}" width="520" style="width:100%;max-width:520px;border-radius:10px;border:1px solid #eee;" /></td></tr>`
    )
    .join('')

  const linhasHtml = p.linhas
    .map((l) => {
      const titulo = [l.modelo, l.cor].filter(Boolean).join(' · ') || 'Produto'
      const tams = (l.tamanhos ?? []).map((t) => `${t.tamanho.toUpperCase()}${t.qtd ? `·${t.qtd}` : ''}`).join('  ')
      const ests = (l.estampas ?? []).map((e) => `estampa ${e.posicao}/${e.tamanho}`).join(', ')
      return `<tr><td style="padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333;">
        <strong>${titulo}</strong>${l.total ? ` — ${l.total} un.` : ''}${l.material ? `<br><span style="color:#888;">${l.material}</span>` : ''}
        ${tams ? `<br><span style="color:#888;font-size:12px;">${tams}</span>` : ''}
        ${ests ? `<br><span style="color:#0F6E56;font-size:12px;">${ests}</span>` : ''}
      </td></tr>`
    })
    .join('')

  const pixBloco = p.copiaCola
    ? `<table width="100%" style="margin-top:8px;"><tr><td align="center">
        <img src="${SITE}/api/pedido/assistente/${p.id}/pix-qr" alt="QR Code PIX" width="200" height="200" style="border:1px solid #eee;border-radius:8px;" />
       </td></tr>
       <tr><td style="padding-top:10px;font-size:12px;color:#666;">PIX copia e cola:</td></tr>
       <tr><td><div style="word-break:break-all;background:#f6f6f6;border:1px solid #eee;border-radius:8px;padding:10px;font-family:monospace;font-size:12px;color:#333;">${p.copiaCola}</div></td></tr></table>`
    : ''

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
  <body style="margin:0;background:#f4f5f6;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f6;padding:24px 0;"><tr><td align="center">
  <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;max-width:560px;width:100%;">
    <tr><td style="background:#0a0a0a;padding:18px 24px;color:#fff;font-size:18px;font-weight:bold;">CONFECCIONE</td></tr>
    <tr><td style="padding:24px;">
      <p style="font-size:16px;color:#111;margin:0 0 4px;">Olá${p.nome ? `, ${p.nome.split(' ')[0]}` : ''}! 👋</p>
      <p style="font-size:14px;color:#555;margin:0 0 16px;line-height:1.5;">Seu pedido <strong>#${id8}</strong> foi confirmado. Abaixo o resumo, a prévia dos produtos e o link de pagamento (PIX ou cartão). Assim que o pagamento for confirmado, seu pedido entra em produção.</p>

      <p style="font-size:13px;color:#888;text-transform:uppercase;letter-spacing:.04em;margin:18px 0 6px;">Resumo</p>
      <table width="100%" cellpadding="0" cellspacing="0">${linhasHtml}</table>

      <table width="100%" style="margin-top:14px;"><tr>
        <td style="font-size:15px;color:#111;font-weight:bold;">Total</td>
        <td align="right" style="font-size:18px;color:#0F6E56;font-weight:bold;">${brl(p.totalCentavos)}</td>
      </tr></table>

      ${p.numImagens > 0 ? `<p style="font-size:13px;color:#888;text-transform:uppercase;letter-spacing:.04em;margin:22px 0 6px;">Prévia dos produtos</p><table width="100%" cellpadding="0" cellspacing="0">${imagensHtml}</table>` : ''}

      <p style="font-size:13px;color:#888;text-transform:uppercase;letter-spacing:.04em;margin:22px 0 6px;">Pagamento (PIX ou cartão)</p>
      ${pixBloco}
      <table width="100%" style="margin-top:16px;"><tr><td align="center">
        <a href="${p.invoiceUrl}" style="display:inline-block;background:#1D9E75;color:#fff;text-decoration:none;font-size:15px;font-weight:bold;padding:12px 28px;border-radius:10px;">Pagar (PIX ou cartão)</a>
      </td></tr></table>

      <p style="font-size:12px;color:#999;margin:22px 0 0;line-height:1.5;">Dúvidas? Responda este e-mail ou fale no WhatsApp (81) 99578-2077.</p>
    </td></tr>
  </table>
  <p style="font-size:11px;color:#aaa;margin:16px 0 0;">Confeccione — confeccione.com.br</p>
  </td></tr></table></body></html>`

  const text = `Pedido #${id8} confirmado!\n\nTotal: ${brl(p.totalCentavos)}\n\nPagar via PIX:\n${p.copiaCola ?? p.invoiceUrl}\n\nPágina de pagamento: ${p.invoiceUrl}\n\nConfeccione`

  try {
    const resp = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [p.email], reply_to: 'contato@confeccione.com.br', subject: `Pedido #${id8} confirmado — pague via PIX`, html, text }),
    })
    if (!resp.ok) console.error('[email-pedido] Resend erro', resp.status, await resp.text())
  } catch (err) {
    console.error('[email-pedido] exceção', err)
  }
}
