// Envio de emails via Resend.
// Usa a REST API direto (sem SDK) pra não adicionar dependência.
// Se RESEND_API_KEY não estiver configurada, a função loga e sai sem erro —
// assim dá pra rodar local sem quebrar o fluxo de pedidos/cadastros.

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const FROM = 'Confeccione <contato@confeccione.com.br>'
const REPLY_TO = 'contato@confeccione.com.br'
const SITE_URL = 'https://confeccione.com.br'

type SendParams = {
  to: string
  subject: string
  html: string
  text: string
}

async function enviarEmail({ to, subject, html, text }: SendParams): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY

  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY ausente — email não enviado:', { to, subject })
    return
  }

  if (!to || !to.includes('@')) {
    console.warn('[email] destinatário inválido, ignorando:', to)
    return
  }

  try {
    const resp = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        reply_to: REPLY_TO,
        subject,
        html,
        text,
      }),
    })

    if (!resp.ok) {
      const body = await resp.text()
      console.error('[email] Resend erro', resp.status, body)
    }
  } catch (err) {
    console.error('[email] exceção no envio', err)
  }
}

// ─── Template base ─────────────────────────────────────────────
// HTML minimal compatível com clientes de email (Gmail, Outlook, Apple Mail).
// Usa tabela + inline styles (padrão da indústria — email não suporta CSS moderno).

function layout(conteudo: string, preheader: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confeccione</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:#2563eb;padding:28px 32px;">
              <div style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;">Confeccione</div>
              <div style="color:#c7d7ff;font-size:13px;margin-top:2px;">Conectando quem produz a quem precisa</div>
            </td>
          </tr>
          <!-- Conteúdo -->
          <tr>
            <td style="padding:32px;color:#1f2937;font-size:15px;line-height:1.6;">
              ${conteudo}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#fafafa;padding:20px 32px;border-top:1px solid #eeeeee;color:#888;font-size:12px;line-height:1.5;">
              Confeccione · <a href="${SITE_URL}" style="color:#2563eb;text-decoration:none;">confeccione.com.br</a><br>
              Dúvidas? Responda este email que a gente te ajuda.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// ─── Email 1: Boas-vindas ao fornecedor ────────────────────────

export async function emailBoasVindasFornecedor(params: {
  email: string
  nome: string
}): Promise<void> {
  const nomeEsc = escapeHtml(params.nome)
  const subject = 'Bem-vindo ao Confeccione 🎉'
  const preheader = 'Seu cadastro foi confirmado. Em breve chegam os primeiros pedidos.'

  const html = layout(
    `
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827;">Olá, ${nomeEsc}! 🎉</h1>
    <p style="margin:0 0 16px;">Seu cadastro no <strong>Confeccione</strong> foi confirmado com sucesso.</p>
    <p style="margin:0 0 16px;">A partir de agora, quando chegar um pedido que bate com o perfil da sua produção, a gente te avisa pelo WhatsApp cadastrado. Você responde <strong>SIM</strong> se quiser atender ou <strong>NÃO</strong> pra gente passar pra outro fornecedor.</p>
    <div style="background:#f0f7ff;border-left:3px solid #2563eb;padding:14px 18px;margin:24px 0;border-radius:6px;">
      <div style="font-weight:600;color:#1e40af;margin-bottom:6px;">Como funciona</div>
      <div style="color:#1f2937;font-size:14px;line-height:1.6;">
        1. Cliente faz um pedido no site<br>
        2. Se bater com seu perfil, você recebe no WhatsApp<br>
        3. Você tem 4h pra responder SIM ou NÃO<br>
        4. Se aceitar, entramos em contato pra alinhar os detalhes
      </div>
    </div>
    <p style="margin:16px 0 0;color:#666;font-size:14px;">Qualquer dúvida, é só responder este email.</p>
    `,
    preheader
  )

  const text = `Olá, ${params.nome}!

Seu cadastro no Confeccione foi confirmado com sucesso.

A partir de agora, quando chegar um pedido que bate com o perfil da sua produção, a gente te avisa pelo WhatsApp cadastrado. Você responde SIM se quiser atender ou NÃO pra gente passar pra outro fornecedor.

Como funciona:
1. Cliente faz um pedido no site
2. Se bater com seu perfil, você recebe no WhatsApp
3. Você tem 4h pra responder SIM ou NÃO
4. Se aceitar, entramos em contato pra alinhar os detalhes

Qualquer dúvida, é só responder este email.

Confeccione
${SITE_URL}`

  await enviarEmail({ to: params.email, subject, html, text })
}

// ─── Email 2: Notificação de oferta ao fornecedor ──────────────

export async function emailOfertaFornecedor(params: {
  email: string
  nomeFornecedor: string
  tipo: string
  quantidade: number | null
  estado: string
  prazo: string
  descricao: string | null
}): Promise<void> {
  const nomeEsc = escapeHtml(params.nomeFornecedor)
  const tipoEsc = escapeHtml(params.tipo)
  const estadoEsc = escapeHtml(params.estado)
  const prazoEsc = escapeHtml(params.prazo)
  const descEsc = params.descricao ? escapeHtml(params.descricao) : null

  const subject = `Novo pedido pra você: ${params.tipo}`
  const preheader = 'Um cliente tem um pedido que bate com seu perfil. Confira no WhatsApp.'

  const qtdLinha =
    params.quantidade !== null && params.quantidade !== undefined
      ? `<tr><td style="padding:6px 0;color:#666;width:100px;">Quantidade</td><td style="padding:6px 0;color:#111827;font-weight:500;">${params.quantidade} peças</td></tr>`
      : ''

  const descBloco = descEsc
    ? `<div style="background:#fafafa;border:1px solid #eeeeee;padding:14px 16px;margin-top:16px;border-radius:6px;font-size:14px;color:#1f2937;"><strong style="color:#666;display:block;margin-bottom:4px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Detalhes do cliente</strong>${descEsc}</div>`
    : ''

  const html = layout(
    `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Novo pedido, ${nomeEsc}!</h1>
    <p style="margin:0 0 20px;color:#666;">Um cliente tem uma demanda que bate com seu perfil de produção.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #eeeeee;border-bottom:1px solid #eeeeee;margin:8px 0;">
      <tr><td style="padding:6px 0;color:#666;width:100px;">Tipo</td><td style="padding:6px 0;color:#111827;font-weight:500;">${tipoEsc}</td></tr>
      ${qtdLinha}
      <tr><td style="padding:6px 0;color:#666;">Estado</td><td style="padding:6px 0;color:#111827;font-weight:500;">${estadoEsc}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Prazo</td><td style="padding:6px 0;color:#111827;font-weight:500;">${prazoEsc}</td></tr>
    </table>
    ${descBloco}
    <div style="background:#fff7ed;border-left:3px solid #f59e0b;padding:14px 18px;margin:24px 0;border-radius:6px;">
      <strong style="color:#9a3412;">⏱️ Responda no WhatsApp em até 4h</strong>
      <p style="margin:6px 0 0;color:#1f2937;font-size:14px;line-height:1.5;">Envie <strong>SIM</strong> pra aceitar ou <strong>NÃO</strong> pra recusar. Sem resposta, passamos pro próximo fornecedor.</p>
    </div>
    <p style="margin:16px 0 0;color:#666;font-size:14px;">Este email é um backup da notificação que você recebeu no WhatsApp.</p>
    `,
    preheader
  )

  const text = `Novo pedido, ${params.nomeFornecedor}!

Um cliente tem uma demanda que bate com seu perfil de produção.

Tipo: ${params.tipo}${params.quantidade ? `\nQuantidade: ${params.quantidade} peças` : ''}
Estado: ${params.estado}
Prazo: ${params.prazo}
${params.descricao ? `\nDetalhes: ${params.descricao}` : ''}

⏱️ Responda no WhatsApp em até 4h.

Envie SIM pra aceitar ou NÃO pra recusar. Sem resposta, passamos pro próximo fornecedor.

Este email é um backup da notificação que você recebeu no WhatsApp.

Confeccione
${SITE_URL}`

  await enviarEmail({ to: params.email, subject, html, text })
}

// ─── Email 3: Confirmação de pedido ao cliente ─────────────────

export async function emailConfirmacaoCliente(params: {
  email: string
  nomeCliente: string
  protocolo: string
  tipo: string
  quantidade: number | null
  estado: string
  prazo: string
}): Promise<void> {
  const nomeEsc = escapeHtml(params.nomeCliente)
  const tipoEsc = escapeHtml(params.tipo)
  const estadoEsc = escapeHtml(params.estado)
  const prazoEsc = escapeHtml(params.prazo)
  const protocoloCurto = params.protocolo.slice(0, 8).toUpperCase()

  const subject = `Pedido recebido — #${protocoloCurto}`
  const preheader = 'Recebemos seu pedido. Já estamos buscando o fornecedor ideal.'

  const qtdLinha =
    params.quantidade !== null && params.quantidade !== undefined
      ? `<tr><td style="padding:6px 0;color:#666;width:100px;">Quantidade</td><td style="padding:6px 0;color:#111827;font-weight:500;">${params.quantidade} peças</td></tr>`
      : ''

  const html = layout(
    `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Recebemos seu pedido, ${nomeEsc}! ✅</h1>
    <p style="margin:0 0 20px;color:#666;">Estamos procurando o fornecedor ideal pra você. Em breve chega uma resposta no seu WhatsApp.</p>
    <div style="background:#eff6ff;padding:14px 18px;margin:20px 0;border-radius:6px;">
      <div style="color:#1e40af;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Protocolo</div>
      <div style="color:#1e3a8a;font-size:18px;font-weight:700;font-family:'SF Mono',Monaco,monospace;margin-top:2px;">#${protocoloCurto}</div>
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #eeeeee;border-bottom:1px solid #eeeeee;margin:8px 0;">
      <tr><td style="padding:6px 0;color:#666;width:100px;">Tipo</td><td style="padding:6px 0;color:#111827;font-weight:500;">${tipoEsc}</td></tr>
      ${qtdLinha}
      <tr><td style="padding:6px 0;color:#666;">Estado</td><td style="padding:6px 0;color:#111827;font-weight:500;">${estadoEsc}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Prazo</td><td style="padding:6px 0;color:#111827;font-weight:500;">${prazoEsc}</td></tr>
    </table>
    <div style="background:#f0f7ff;border-left:3px solid #2563eb;padding:14px 18px;margin:24px 0;border-radius:6px;">
      <div style="font-weight:600;color:#1e40af;margin-bottom:6px;">Próximos passos</div>
      <div style="color:#1f2937;font-size:14px;line-height:1.6;">
        1. Buscamos um fornecedor que bate com seu pedido<br>
        2. Ele tem até 4h pra aceitar<br>
        3. Se aceitar, entramos em contato no seu WhatsApp pra alinhar os detalhes<br>
        4. Se recusar, já partimos pro próximo — sem você precisar fazer nada
      </div>
    </div>
    <p style="margin:16px 0 0;color:#666;font-size:14px;">Guarde o número do protocolo caso precise falar com a gente.</p>
    `,
    preheader
  )

  const text = `Recebemos seu pedido, ${params.nomeCliente}!

Estamos procurando o fornecedor ideal pra você. Em breve chega uma resposta no seu WhatsApp.

Protocolo: #${protocoloCurto}

Tipo: ${params.tipo}${params.quantidade ? `\nQuantidade: ${params.quantidade} peças` : ''}
Estado: ${params.estado}
Prazo: ${params.prazo}

Próximos passos:
1. Buscamos um fornecedor que bate com seu pedido
2. Ele tem até 4h pra aceitar
3. Se aceitar, entramos em contato no seu WhatsApp pra alinhar os detalhes
4. Se recusar, já partimos pro próximo — sem você precisar fazer nada

Guarde o número do protocolo caso precise falar com a gente.

Confeccione
${SITE_URL}`

  await enviarEmail({ to: params.email, subject, html, text })
}

export async function emailContatoFornecedor(params: {
  email: string
  nomeCliente: string
  tipo: string
  nomeFornecedor: string
  whatsappFornecedor: string
  cidadeFornecedor: string | null
  estadoFornecedor: string
}): Promise<void> {
  const nomeClienteEsc = escapeHtml(params.nomeCliente)
  const tipoEsc = escapeHtml(params.tipo)
  const nomeFornEsc = escapeHtml(params.nomeFornecedor)
  const whatsFornEsc = escapeHtml(params.whatsappFornecedor)
  const localFornEsc = escapeHtml(
    params.cidadeFornecedor
      ? `${params.cidadeFornecedor} / ${params.estadoFornecedor}`
      : params.estadoFornecedor
  )

  // Link wa.me — remove tudo que não é dígito
  const whatsLink = params.whatsappFornecedor.replace(/\D/g, '')

  const subject = `Encontramos um fornecedor pro seu pedido!`
  const preheader = `${params.nomeFornecedor} aceitou seu pedido de ${params.tipo}.`

  const html = layout(
    `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Boa notícia, ${nomeClienteEsc}! 🎉</h1>
    <p style="margin:0 0 20px;color:#666;">Encontramos um fornecedor pro seu pedido de <strong>${tipoEsc}</strong>.</p>
    <div style="background:#ecfdf5;padding:18px;margin:20px 0;border-radius:6px;border-left:3px solid #10b981;">
      <div style="color:#047857;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;margin-bottom:8px;">Fornecedor</div>
      <div style="color:#111827;font-size:18px;font-weight:700;margin-bottom:6px;">${nomeFornEsc}</div>
      <div style="color:#374151;font-size:14px;margin-bottom:4px;">📱 ${whatsFornEsc}</div>
      <div style="color:#6b7280;font-size:14px;">📍 ${localFornEsc}</div>
    </div>
    <p style="margin:0 0 16px;color:#374151;line-height:1.6;">Ele vai te chamar nas próximas horas. Se preferir, você também pode entrar em contato direto:</p>
    <div style="text-align:center;margin:24px 0;">
      <a href="https://wa.me/${whatsLink}" style="display:inline-block;background:#25d366;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">Falar no WhatsApp</a>
    </div>
    <div style="background:#fffbeb;border-left:3px solid #f59e0b;padding:14px 18px;margin:24px 0;border-radius:6px;">
      <div style="color:#1f2937;font-size:14px;line-height:1.6;">
        <strong>Daqui a 24h vamos te chamar no WhatsApp</strong> pra saber se deu certo. Se não rolou, a gente busca outro fornecedor pra você.
      </div>
    </div>
    `,
    preheader
  )

  const text = `Boa notícia, ${params.nomeCliente}!

Encontramos um fornecedor pro seu pedido de ${params.tipo}.

Fornecedor: ${params.nomeFornecedor}
WhatsApp: ${params.whatsappFornecedor}
Localização: ${params.cidadeFornecedor ? `${params.cidadeFornecedor} / ` : ''}${params.estadoFornecedor}

Ele vai te chamar nas próximas horas. Se preferir, você também pode entrar em contato direto:
https://wa.me/${whatsLink}

Daqui a 24h vamos te chamar no WhatsApp pra saber se deu certo. Se não rolou, a gente busca outro fornecedor pra você.

Confeccione
${SITE_URL}`

  await enviarEmail({ to: params.email, subject, html, text })
}
