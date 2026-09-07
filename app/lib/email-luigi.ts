// app/lib/email-luigi.ts
// ============================================================================
// E-MAIL DE TEXTO DO LUIGI — o envelope e a diagramação dos templates "só
// texto" do motor de marketing (as réguas assinadas "Luigi, da Confeccione").
//
// A régua é escrita como texto puro no admin (é o que o Fernando edita e o
// que vai no corpo `text`). Aqui esse texto vira um e-mail com cara de gente
// da equipe, não de newsletter: logo pequena em cima, cartão branco, botão
// verde no lugar do link cru, assinatura com avatar e rodapé discreto.
//
// Regras de diagramação (todas derivadas do texto, sem marcação nova):
//   - primeiro parágrafo "Oi, Ana." vira a saudação, um pouco maior;
//   - parágrafo com link (#link já resolvido em https://…) vira um botão;
//     o texto antes do link fica como frase, e some se for só um rótulo
//     ("Seu pedido:"). O rótulo do botão vem da intenção da frase
//     (completar, confirmar, retomar, montar) ou é "Ver meu pedido";
//   - último parágrafo "Luigi, da Confeccione" vira o bloco de assinatura;
//   - *negrito* vira <strong>, como no WhatsApp e nos blocos.
//
// Tabela + estilo inline de propósito: e-mail não entende CSS moderno
// (Gmail, Outlook, Apple Mail). O texto puro segue indo no par `text`.
// ============================================================================

const VERDE = '#1D9E75'
const ESCURO = '#0E1814'
const TEXTO = '#1F2937'
const MUDO = '#6B7280'
const FUNDO = '#F3F4F1'
const BORDA = '#E6E8E4'
const SITE = 'https://confeccione.com.br'
const LOGO = `${SITE}/icons/icon-192.png`

function escapar(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}

/** Só http(s) entra num href. */
function urlSegura(u: string): string {
  return /^https?:\/\//i.test(u) ? escapar(u) : ''
}

function inline(texto: string): string {
  return escapar(texto)
    .replace(/\n/g, '<br>')
    .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
    .replace(/(https?:\/\/[^\s<]+)/g, `<a href="$1" style="color:${VERDE};text-decoration:underline;">$1</a>`)
}

const URL_RE = /https?:\/\/[^\s<]+/

/** Rótulo do botão pela intenção da frase que acompanha o link. */
function rotuloDoBotao(frase: string): string {
  const f = frase.toLowerCase()
  if (/\bcadastr/.test(f)) return 'Fazer meu cadastro'
  if (/\bmontar\b/.test(f)) return 'Montar meu pedido'
  if (/\bcompletar\b/.test(f)) return 'Completar meu pedido'
  if (/\bconfirmar\b/.test(f)) return 'Confirmar meu pedido'
  if (/\bretom/.test(f)) return 'Retomar meu pedido'
  if (/\bpagar\b|\bpagamento\b/.test(f)) return 'Ver orçamento e pagar'
  if (/\borçamento\b/.test(f)) return 'Ver meu orçamento'
  return 'Ver meu pedido'
}

function botao(url: string, rotulo: string): string {
  const href = urlSegura(url)
  if (!href) return ''
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 22px;">
<tr><td style="background:${VERDE};border-radius:8px;">
<a href="${href}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${escapar(rotulo)}</a>
</td></tr></table>`
}

function paragrafo(html: string, extra = ''): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:${TEXTO};${extra}">${html}</p>`
}

function saudacao(texto: string): string {
  return `<p style="margin:0 0 18px;font-size:17px;line-height:1.5;color:${ESCURO};">${inline(texto)}</p>`
}

function assinatura(): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0;">
<tr>
<td width="44" valign="middle" style="padding:0;">
<div style="width:40px;height:40px;border-radius:20px;background:${VERDE};color:#ffffff;font-size:17px;font-weight:700;text-align:center;line-height:40px;">L</div>
</td>
<td valign="middle" style="padding:0 0 0 12px;">
<div style="font-size:15px;font-weight:600;color:${ESCURO};line-height:1.3;">Luigi</div>
<div style="font-size:13px;color:${MUDO};line-height:1.3;">Atendimento · Confeccione</div>
</td>
</tr></table>`
}

const SAUDACAO_RE = /^(oi|olá|ola|bom dia|boa tarde|boa noite|prazer)\b/i
const ASSINATURA_RE = /^[—–-]?\s*luigi\s*,?\s*(da\s+)?confeccione\.?$/i
/** Frase de saída ("pra não receber mais…"): fica como texto miúdo com link, nunca vira botão. */
const OPT_OUT_RE = /n[aã]o (receber|quer(o|em)? mais)|descadastr|sair da lista/i

/** O texto da régua vira o miolo do e-mail (sem envelope). */
export function renderTextoLuigi(corpo: string): string {
  const pars = corpo
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)

  const partes: string[] = []
  pars.forEach((par, i) => {
    if (i === 0 && SAUDACAO_RE.test(par) && par.length <= 80) {
      partes.push(saudacao(par))
      return
    }
    if (i === pars.length - 1 && ASSINATURA_RE.test(par)) {
      partes.push(assinatura())
      return
    }
    const m = par.match(URL_RE)
    if (m && OPT_OUT_RE.test(par)) {
      const href = urlSegura(m[0])
      const antes = par.replace(m[0], '').replace(/\s*:\s*$/, ':').trim()
      partes.push(paragrafo(`${inline(antes)} <a href="${href}" style="color:${MUDO};text-decoration:underline;">clique aqui</a>.`, `font-size:13px;color:${MUDO};`))
      return
    }
    if (m) {
      const url = m[0]
      const frase = par.replace(url, '').replace(/\s*:\s*$/, '').replace(/\s{2,}/g, ' ').trim()
      const soRotulo = frase.split(/\s+/).length <= 3
      if (frase && !soRotulo) partes.push(paragrafo(inline(/[.!?]$/.test(frase) ? frase : `${frase}.`)))
      partes.push(botao(url, rotuloDoBotao(par)))
      return
    }
    partes.push(paragrafo(inline(par)))
  })
  return partes.join('\n')
}

/**
 * Envelope da Confeccione pro e-mail de texto: logo pequena, cartão branco,
 * rodapé com descadastro. Leve de propósito — parece e-mail de uma pessoa.
 */
export function layoutLuigi(miolo: string, preheader: string, descadastro: string | null): string {
  const desc = descadastro ? urlSegura(descadastro) : ''
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="light"><title>Confeccione</title></head>
<body style="margin:0;padding:0;background:${FUNDO};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapar(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${FUNDO};padding:28px 16px 36px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
        <tr><td style="padding:0 6px 14px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td width="34" valign="middle" style="padding:0;"><a href="${SITE}" style="text-decoration:none;"><img src="${LOGO}" width="30" height="30" alt="Confeccione" style="display:block;border:0;border-radius:15px;"></a></td>
              <td valign="middle" style="padding:0 0 0 10px;"><a href="${SITE}" style="font-size:13px;font-weight:700;letter-spacing:3px;color:${ESCURO};text-decoration:none;">CONFECCIONE</a></td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="background:#ffffff;border:1px solid ${BORDA};border-radius:14px;padding:34px 36px 30px;">
${miolo}
        </td></tr>
        <tr><td style="padding:18px 8px 0;font-size:12px;line-height:1.6;color:#8A918D;text-align:center;">
          Confeccione · confecções verificadas em todo o Brasil · <a href="${SITE}" style="color:#8A918D;text-decoration:underline;">confeccione.com.br</a><br>
          Pode responder este e-mail: cai direto com a gente.${desc ? `<br>Você recebe este e-mail porque se cadastrou ou pediu orçamento na Confeccione. <a href="${desc}" style="color:#8A918D;text-decoration:underline;">Descadastrar</a>.` : ''}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

/** E-mail completo a partir do texto da régua (já com marcadores resolvidos). */
export function emailTextoLuigi(corpo: string, assunto: string, descadastro: string | null): string {
  return layoutLuigi(renderTextoLuigi(corpo), assunto, descadastro)
}
