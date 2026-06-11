// app/lib/email-pedido.ts
// ============================================================================
// E-mails do pedido do chat (pedidos_assistente), via Resend (REST):
//   1. enviarEmailPedidoRecebido — pedido confirmado SEM preço ("buscando o
//      fornecedor ideal"); convida pro painel do cliente.
//   2. enviarEmailOrcamentoFinal — orçamento definido pelo fornecedor (valores
//      + quem vai atender + link pra pagar).
//   3. enviarEmailPedidoPix — cobrança gerada (QR + copia e cola + link).
// Imagens e QR são referenciados por URL (endpoints públicos do pedido) —
// base64 inline costuma ser bloqueado por clientes de e-mail.
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

function linhasHtmlDe(linhas: LinhaEmail[]): string {
  return linhas
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
}

function imagensHtmlDe(pedidoId: string, numImagens: number): string {
  return Array.from({ length: numImagens })
    .map(
      (_, i) =>
        `<tr><td style="padding:6px 0;"><img src="${SITE}/api/pedido/assistente/${pedidoId}/imagem?i=${i}" alt="produto ${i + 1}" width="520" style="width:100%;max-width:520px;border-radius:10px;border:1px solid #eee;" /></td></tr>`
    )
    .join('')
}

function moldura(conteudo: string): string {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
  <body style="margin:0;background:#f4f5f6;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f6;padding:24px 0;"><tr><td align="center">
  <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;max-width:560px;width:100%;">
    <tr><td style="background:#0a0a0a;padding:18px 24px;color:#fff;font-size:18px;font-weight:bold;">CONFECCIONE</td></tr>
    <tr><td style="padding:24px;">${conteudo}</td></tr>
  </table>
  <p style="font-size:11px;color:#aaa;margin:16px 0 0;">Confeccione — confeccione.com.br</p>
  </td></tr></table></body></html>`
}

async function enviar(to: string, subject: string, html: string, text: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[email-pedido] RESEND_API_KEY ausente — email não enviado')
    return
  }
  if (!to || !to.includes('@')) return
  try {
    const resp = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], reply_to: 'contato@confeccione.com.br', subject, html, text }),
    })
    if (!resp.ok) console.error('[email-pedido] Resend erro', resp.status, await resp.text())
  } catch (err) {
    console.error('[email-pedido] exceção', err)
  }
}

// ---------------------------------------------------------------------------
// 1) Pedido recebido — SEM preço. "Estamos encontrando o fornecedor ideal."
// ---------------------------------------------------------------------------
export async function enviarEmailPedidoRecebido(p: {
  id: string
  email: string
  nome: string | null
  linhas: LinhaEmail[]
  numImagens: number
}): Promise<void> {
  const id8 = p.id.slice(0, 8)
  const linkVis = `${SITE}/visualizador/${p.id}`
  const linkPainel = `${SITE}/cliente/login`

  const conteudo = `
      <p style="font-size:16px;color:#111;margin:0 0 4px;">Olá${p.nome ? `, ${p.nome.split(' ')[0]}` : ''}! 👋</p>
      <p style="font-size:14px;color:#555;margin:0 0 16px;line-height:1.5;">Recebemos seu pedido <strong>#${id8}</strong>! 🎉 Agora nosso time está <strong>encontrando o fornecedor ideal</strong> pra produzir suas peças com a melhor qualidade.</p>

      <div style="background:#E1F5EE;border:1px solid #b9e4d4;border-radius:10px;padding:14px;margin-bottom:18px;">
        <p style="font-size:13px;color:#0F6E56;margin:0;line-height:1.6;"><strong>🔎 O que acontece agora?</strong><br>
        1. Selecionamos o fornecedor ideal pro seu pedido;<br>
        2. Ele prepara o <strong>orçamento final</strong> (produtos + frete);<br>
        3. Você recebe tudo por <strong>e-mail e WhatsApp</strong> — e só paga se aprovar.</p>
      </div>

      <p style="font-size:13px;color:#888;text-transform:uppercase;letter-spacing:.04em;margin:18px 0 6px;">Resumo do pedido</p>
      <table width="100%" cellpadding="0" cellspacing="0">${linhasHtmlDe(p.linhas)}</table>

      ${p.numImagens > 0 ? `<p style="font-size:13px;color:#888;text-transform:uppercase;letter-spacing:.04em;margin:22px 0 6px;">Prévia dos produtos</p><table width="100%" cellpadding="0" cellspacing="0">${imagensHtmlDe(p.id, p.numImagens)}</table>` : ''}

      <table width="100%" style="margin-top:20px;"><tr><td align="center">
        <a href="${linkVis}" style="display:inline-block;background:#1D9E75;color:#fff;text-decoration:none;font-size:15px;font-weight:bold;padding:12px 28px;border-radius:10px;">Acompanhar meu pedido</a>
      </td></tr></table>

      <p style="font-size:12px;color:#555;margin:20px 0 0;line-height:1.6;">💡 <strong>Dica:</strong> acesse seu painel em <a href="${linkPainel}" style="color:#0F6E56;">confeccione.com.br/cliente/login</a> (entre com este e-mail) pra acompanhar todos os seus pedidos num lugar só.</p>
      <p style="font-size:12px;color:#999;margin:14px 0 0;line-height:1.5;">Dúvidas? Responda este e-mail ou fale no WhatsApp (81) 99578-2077.</p>`

  const text = `Recebemos seu pedido #${id8}!\n\nEstamos encontrando o fornecedor ideal pras suas peças. Você vai receber o orçamento final por e-mail e WhatsApp — e só paga se aprovar.\n\nAcompanhe: ${linkVis}\nSeu painel: ${linkPainel}\n\nConfeccione`

  await enviar(p.email, `Recebemos seu pedido #${id8} — buscando o fornecedor ideal 🧵`, moldura(conteudo), text)
}

// ---------------------------------------------------------------------------
// 2) Orçamento final — fornecedor definiu os valores. Link pra ver e pagar.
// ---------------------------------------------------------------------------
export async function enviarEmailOrcamentoFinal(p: {
  id: string
  email: string
  nome: string | null
  fornecedorNome: string | null
  totalCentavos: number
  freteCentavos: number | null
  linhas: LinhaEmail[]
}): Promise<void> {
  const id8 = p.id.slice(0, 8)
  const linkVis = `${SITE}/visualizador/${p.id}`
  const frete = p.freteCentavos ?? 0
  const produtos = Math.max(p.totalCentavos - frete, 0)

  const conteudo = `
      <p style="font-size:16px;color:#111;margin:0 0 4px;">Olá${p.nome ? `, ${p.nome.split(' ')[0]}` : ''}! 🎉</p>
      <p style="font-size:14px;color:#555;margin:0 0 16px;line-height:1.5;">Boa notícia: <strong>seu orçamento saiu!</strong>${p.fornecedorNome ? ` O fornecedor <strong>${p.fornecedorNome}</strong> vai atender o pedido <strong>#${id8}</strong>.` : ` Já temos um fornecedor pro pedido <strong>#${id8}</strong>.`}</p>

      <p style="font-size:13px;color:#888;text-transform:uppercase;letter-spacing:.04em;margin:18px 0 6px;">Resumo</p>
      <table width="100%" cellpadding="0" cellspacing="0">${linhasHtmlDe(p.linhas)}</table>

      <table width="100%" style="margin-top:14px;font-size:14px;color:#555;">
        <tr><td style="padding:3px 0;">Produtos</td><td align="right">${brl(produtos)}</td></tr>
        <tr><td style="padding:3px 0;">Frete</td><td align="right">${frete > 0 ? brl(frete) : 'incluso'}</td></tr>
        <tr><td style="padding:8px 0 0;font-size:15px;color:#111;font-weight:bold;">Total</td><td align="right" style="padding:8px 0 0;font-size:18px;color:#0F6E56;font-weight:bold;">${brl(p.totalCentavos)}</td></tr>
      </table>

      <table width="100%" style="margin-top:20px;"><tr><td align="center">
        <a href="${linkVis}" style="display:inline-block;background:#1D9E75;color:#fff;text-decoration:none;font-size:15px;font-weight:bold;padding:12px 28px;border-radius:10px;">Ver orçamento e pagar</a>
      </td></tr></table>

      <p style="font-size:12px;color:#555;margin:20px 0 0;line-height:1.6;">🔒 <strong>Pagamento garantido pela Confeccione:</strong> seguramos o valor e só repassamos ao fornecedor quando você confirmar que recebeu tudo em conformidade.</p>
      <p style="font-size:12px;color:#999;margin:14px 0 0;line-height:1.5;">Dúvidas? Responda este e-mail ou fale no WhatsApp (81) 99578-2077.</p>`

  const text = `Seu orçamento saiu! Pedido #${id8}${p.fornecedorNome ? ` — fornecedor: ${p.fornecedorNome}` : ''}\n\nProdutos: ${brl(produtos)}\nFrete: ${frete > 0 ? brl(frete) : 'incluso'}\nTotal: ${brl(p.totalCentavos)}\n\nVer e pagar: ${linkVis}\n\nConfeccione`

  await enviar(p.email, `Seu orçamento saiu! Pedido #${id8} — ${brl(p.totalCentavos)} 💰`, moldura(conteudo), text)
}

// ---------------------------------------------------------------------------
// 3) Cobrança gerada — QR PIX + copia e cola + link (PIX ou cartão).
// ---------------------------------------------------------------------------
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
  const id8 = p.id.slice(0, 8)

  const pixBloco = p.copiaCola
    ? `<table width="100%" style="margin-top:8px;"><tr><td align="center">
        <img src="${SITE}/api/pedido/assistente/${p.id}/pix-qr" alt="QR Code PIX" width="200" height="200" style="border:1px solid #eee;border-radius:8px;" />
       </td></tr>
       <tr><td style="padding:14px 0 6px;font-size:13px;color:#111;font-weight:bold;">Código PIX copia e cola</td></tr>
       <tr><td style="font-size:12px;color:#888;padding-bottom:6px;">Selecione (ou toque e segure no celular) o código abaixo para copiar:</td></tr>
       <tr><td>
         <div style="-webkit-user-select:all;user-select:all;word-break:break-all;background:#f6f6f6;border:1px dashed #1D9E75;border-radius:8px;padding:14px;font-family:'Courier New',monospace;font-size:14px;line-height:1.5;color:#111;letter-spacing:.2px;">${p.copiaCola}</div>
       </td></tr></table>`
    : ''

  const conteudo = `
      <p style="font-size:16px;color:#111;margin:0 0 4px;">Olá${p.nome ? `, ${p.nome.split(' ')[0]}` : ''}! 👋</p>
      <p style="font-size:14px;color:#555;margin:0 0 16px;line-height:1.5;">Sua cobrança do pedido <strong>#${id8}</strong> está pronta. Abaixo o resumo e o pagamento (PIX ou cartão). Assim que o pagamento for confirmado, seu pedido entra em produção.</p>

      <p style="font-size:13px;color:#888;text-transform:uppercase;letter-spacing:.04em;margin:18px 0 6px;">Resumo</p>
      <table width="100%" cellpadding="0" cellspacing="0">${linhasHtmlDe(p.linhas)}</table>

      <table width="100%" style="margin-top:14px;"><tr>
        <td style="font-size:15px;color:#111;font-weight:bold;">Total</td>
        <td align="right" style="font-size:18px;color:#0F6E56;font-weight:bold;">${brl(p.totalCentavos)}</td>
      </tr></table>

      ${p.numImagens > 0 ? `<p style="font-size:13px;color:#888;text-transform:uppercase;letter-spacing:.04em;margin:22px 0 6px;">Prévia dos produtos</p><table width="100%" cellpadding="0" cellspacing="0">${imagensHtmlDe(p.id, p.numImagens)}</table>` : ''}

      <p style="font-size:13px;color:#888;text-transform:uppercase;letter-spacing:.04em;margin:22px 0 6px;">Pagamento (PIX ou cartão)</p>
      ${pixBloco}
      <table width="100%" style="margin-top:16px;"><tr><td align="center">
        <a href="${p.invoiceUrl}" style="display:inline-block;background:#1D9E75;color:#fff;text-decoration:none;font-size:15px;font-weight:bold;padding:12px 28px;border-radius:10px;">Pagar (PIX ou cartão)</a>
      </td></tr></table>

      <p style="font-size:12px;color:#999;margin:14px 0 0;line-height:1.5;">Dúvidas? Responda este e-mail ou fale no WhatsApp (81) 99578-2077.</p>`

  const text = `Cobrança do pedido #${id8}\n\nTotal: ${brl(p.totalCentavos)}\n\nPagar via PIX:\n${p.copiaCola ?? p.invoiceUrl}\n\nPágina de pagamento: ${p.invoiceUrl}\n\nConfeccione`

  await enviar(p.email, `Pedido #${id8} — pagamento disponível (${brl(p.totalCentavos)})`, moldura(conteudo), text)
}
