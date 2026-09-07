// app/lib/email-blocos.ts
// ============================================================================
// E-MAIL MONTADO POR BLOCOS
//
// O template guarda uma lista de blocos; aqui a gente vira isso em HTML de
// e-mail de verdade. "De verdade" quer dizer: tabela aninhada com estilo
// inline, largura fixa de 600px e imagem com width no atributo — é feio de
// escrever e é o único jeito que sobrevive ao Outlook, que renderiza e-mail
// com o motor do Word e ignora flexbox, grid e boa parte de CSS moderno.
//
// Regra que vale mais que o design: TEXTO É TEXTO, BOTÃO É HTML. Nada de
// e-mail que é uma imagem só — cliente de e-mail bloqueia imagem por padrão
// em remetente novo (o leitor veria um retângulo vazio) e filtro de spam lê
// texto, então imagem-única queima o domínio. Por isso não existe bloco de
// "arte inteira": a imagem entra ao lado do texto, nunca no lugar dele.
//
// Os marcadores (#nome, #empresa, #cidade, #link, #pedido) sobrevivem à
// renderização e são trocados por lead na hora do envio, em envio-marketing.
// ============================================================================

export type TipoBloco = 'logo' | 'titulo' | 'texto' | 'imagem' | 'botao' | 'divisor' | 'espaco'

export type Bloco =
  | { tipo: 'logo'; url: string; largura?: number; alinhamento?: Alinhamento }
  | { tipo: 'titulo'; texto: string; alinhamento?: Alinhamento }
  | { tipo: 'texto'; texto: string; alinhamento?: Alinhamento }
  | { tipo: 'imagem'; url: string; alt?: string; link?: string }
  | { tipo: 'botao'; texto: string; url: string; cor?: string; alinhamento?: Alinhamento }
  | { tipo: 'divisor' }
  | { tipo: 'espaco'; altura?: number }

export type Alinhamento = 'left' | 'center' | 'right'

export const VERDE = '#1D9E75'
const TEXTO = '#1f2937'

export function blocoVazio(tipo: TipoBloco): Bloco {
  switch (tipo) {
    case 'logo':
      return { tipo: 'logo', url: '', largura: 160, alinhamento: 'left' }
    case 'titulo':
      return { tipo: 'titulo', texto: 'Um título curto e direto', alinhamento: 'left' }
    case 'texto':
      return { tipo: 'texto', texto: 'Oi, #nome!\n\nEscreva aqui.', alinhamento: 'left' }
    case 'imagem':
      return { tipo: 'imagem', url: '', alt: '' }
    case 'botao':
      return { tipo: 'botao', texto: 'Quero um orçamento', url: 'https://www.confeccione.com.br', cor: VERDE, alinhamento: 'left' }
    case 'divisor':
      return { tipo: 'divisor' }
    case 'espaco':
      return { tipo: 'espaco', altura: 24 }
  }
}

export const ROTULO_BLOCO: Record<TipoBloco, string> = {
  logo: 'Logo',
  titulo: 'Título',
  texto: 'Texto',
  imagem: 'Imagem',
  botao: 'Botão',
  divisor: 'Linha',
  espaco: 'Espaço',
}

function escapar(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/** URL segura pra href/src: só http(s), pra ninguém colar javascript:. */
function urlSegura(u: string | undefined): string {
  const v = (u ?? '').trim()
  if (!v) return ''
  if (v.startsWith('#')) return v // marcador (#link) — resolvido no envio
  return /^https?:\/\//i.test(v) ? escapar(v) : ''
}

function paragrafos(texto: string, alinhamento: Alinhamento): string {
  return texto
    .split(/\n{2,}/)
    .map((par) => {
      const html = escapar(par.trim())
        .replace(/\n/g, '<br>')
        // *negrito* vira <strong>, igual ao WhatsApp — é o que o Fernando já escreve
        .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
        .replace(/(https?:\/\/[^\s<]+)/g, `<a href="$1" style="color:${VERDE};text-decoration:underline;">$1</a>`)
      return `<p style="margin:0 0 14px;text-align:${alinhamento};">${html}</p>`
    })
    .join('')
}

/** Um bloco → uma linha da tabela do e-mail. */
function renderBloco(b: Bloco): string {
  switch (b.tipo) {
    case 'logo': {
      const url = urlSegura(b.url)
      if (!url) return ''
      const largura = Math.min(Math.max(b.largura ?? 160, 40), 560)
      return `<tr><td style="padding:0 0 20px;text-align:${b.alinhamento ?? 'left'};">
<img src="${url}" width="${largura}" alt="Confeccione" style="display:inline-block;border:0;max-width:100%;height:auto;">
</td></tr>`
    }

    case 'titulo':
      return `<tr><td style="padding:0 0 12px;">
<h1 style="margin:0;font-size:22px;line-height:1.3;font-weight:700;color:${TEXTO};text-align:${b.alinhamento ?? 'left'};">${escapar(b.texto)}</h1>
</td></tr>`

    case 'texto':
      return `<tr><td style="padding:0;font-size:15px;line-height:1.6;color:${TEXTO};">
${paragrafos(b.texto, b.alinhamento ?? 'left')}
</td></tr>`

    case 'imagem': {
      const url = urlSegura(b.url)
      if (!url) return ''
      const img = `<img src="${url}" width="560" alt="${escapar(b.alt ?? '')}" style="display:block;border:0;width:100%;max-width:560px;height:auto;border-radius:8px;">`
      const link = urlSegura(b.link)
      return `<tr><td style="padding:6px 0 18px;">${link ? `<a href="${link}">${img}</a>` : img}</td></tr>`
    }

    case 'botao': {
      const url = urlSegura(b.url)
      if (!url || !b.texto.trim()) return ''
      const cor = /^#[0-9a-f]{6}$/i.test(b.cor ?? '') ? b.cor : VERDE
      // Botão em tabela (e não <a> com padding) porque o Outlook come padding de link.
      return `<tr><td style="padding:8px 0 20px;text-align:${b.alinhamento ?? 'left'};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;">
<tr><td style="background:${cor};border-radius:8px;">
<a href="${url}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${escapar(b.texto)}</a>
</td></tr></table>
</td></tr>`
    }

    case 'divisor':
      return `<tr><td style="padding:8px 0 20px;"><div style="height:1px;background:#e5e7eb;line-height:1px;font-size:0;">&nbsp;</div></td></tr>`

    case 'espaco':
      return `<tr><td style="height:${Math.min(Math.max(b.altura ?? 24, 4), 80)}px;line-height:1px;font-size:0;">&nbsp;</td></tr>`
  }
}

/** Os blocos viram o miolo do e-mail (sem o envelope nem o rodapé). */
export function renderBlocosHtml(blocos: Bloco[]): string {
  const linhas = blocos.map(renderBloco).filter(Boolean).join('\n')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${linhas}
</table>`
}

/**
 * Versão em texto puro — vai no corpo `text` do e-mail (todo e-mail HTML
 * precisa de um par em texto, senão pontua mal em filtro de spam) e é o que
 * fica gravado no histórico de contatos do lead.
 */
export function blocosParaTexto(blocos: Bloco[]): string {
  const partes: string[] = []
  for (const b of blocos) {
    switch (b.tipo) {
      case 'titulo':
        partes.push(b.texto)
        break
      case 'texto':
        partes.push(b.texto)
        break
      case 'botao':
        if (b.texto.trim() && b.url.trim()) partes.push(`${b.texto}: ${b.url}`)
        break
      case 'imagem':
        if (b.alt?.trim()) partes.push(`[${b.alt}]`)
        break
      default:
        break
    }
  }
  return partes.join('\n\n').trim()
}

/** O que falta pro template poder ser enviado. */
export function pendenciaDosBlocos(blocos: Bloco[]): string | null {
  if (blocos.length === 0) return 'E-mail sem nenhum bloco'
  const temTexto = blocos.some((b) => (b.tipo === 'texto' || b.tipo === 'titulo') && b.texto.trim().length > 0)
  if (!temTexto) return 'Falta texto — e-mail só com imagem cai em spam e chega em branco'
  const logoSemUrl = blocos.some((b) => b.tipo === 'logo' && !b.url.trim())
  if (logoSemUrl) return 'Bloco de logo sem imagem'
  const imagemSemUrl = blocos.some((b) => b.tipo === 'imagem' && !b.url.trim())
  if (imagemSemUrl) return 'Bloco de imagem sem arquivo'
  const botaoQuebrado = blocos.some((b) => b.tipo === 'botao' && (!b.texto.trim() || !b.url.trim()))
  if (botaoQuebrado) return 'Botão sem texto ou sem link'
  return null
}

/**
 * Normaliza o que chega do painel (JSON solto) na união de blocos.
 * O zod da rota valida a forma geral; aqui a gente encaixa cada bloco no
 * seu tipo, preenchendo o que faltar e descartando o que não serve.
 */
export function normalizarBlocos(entrada: unknown): Bloco[] {
  if (!Array.isArray(entrada)) return []
  const out: Bloco[] = []

  for (const item of entrada.slice(0, 40)) {
    if (!item || typeof item !== 'object') continue
    const b = item as Record<string, unknown>
    const txt = (v: unknown, max = 3000) => (typeof v === 'string' ? v.slice(0, max) : '')
    const num = (v: unknown, padrao: number) => (typeof v === 'number' && Number.isFinite(v) ? v : padrao)
    const ali = (v: unknown): Alinhamento => (v === 'center' || v === 'right' ? v : 'left')

    switch (b.tipo) {
      case 'logo':
        out.push({ tipo: 'logo', url: txt(b.url, 600), largura: num(b.largura, 160), alinhamento: ali(b.alinhamento) })
        break
      case 'titulo':
        out.push({ tipo: 'titulo', texto: txt(b.texto, 200), alinhamento: ali(b.alinhamento) })
        break
      case 'texto':
        out.push({ tipo: 'texto', texto: txt(b.texto), alinhamento: ali(b.alinhamento) })
        break
      case 'imagem':
        out.push({ tipo: 'imagem', url: txt(b.url, 600), alt: txt(b.alt, 200), link: txt(b.link, 600) || undefined })
        break
      case 'botao':
        out.push({
          tipo: 'botao',
          texto: txt(b.texto, 60),
          url: txt(b.url, 600),
          cor: txt(b.cor, 9) || VERDE,
          alinhamento: ali(b.alinhamento),
        })
        break
      case 'divisor':
        out.push({ tipo: 'divisor' })
        break
      case 'espaco':
        out.push({ tipo: 'espaco', altura: num(b.altura, 24) })
        break
      default:
        break
    }
  }
  return out
}
