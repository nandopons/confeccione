// app/lib/lista-pdf.ts
// PDF de divulgação da lista de coleta: logo Confeccione, explicação pro grupo,
// link grande + QR code pra escanear. Para o organizador imprimir/compartilhar.
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib'
import * as QRCode from 'qrcode'
import { linkInscricaoUrl } from './listas-externas'

const VERDE = rgb(0.114, 0.62, 0.459)
const VERDE_ESC = rgb(0.059, 0.431, 0.337)
const ESCURO = rgb(0.094, 0.094, 0.094)
const CINZA = rgb(0.42, 0.45, 0.49)
const CINZA_CLARO = rgb(0.85, 0.87, 0.89)
const SITE = 'confeccione.com.br'
const A4 = { w: 595.28, h: 841.89 }
const MX = 48
const TOPO = A4.h - 54

function desenharLogo(page: PDFPage, x: number, yTopo: number, scale: number) {
  const arcs = [
    { d: 'M30 6 A24 24 0 0 1 54 30', op: 1 },
    { d: 'M54 30 A24 24 0 0 1 30 54', op: 0.5 },
    { d: 'M30 54 A24 24 0 0 1 6 30', op: 0.75 },
    { d: 'M6 30 A24 24 0 0 1 30 6', op: 0.35 },
  ]
  for (const a of arcs) {
    page.drawSvgPath(a.d, { x, y: yTopo, scale, borderColor: VERDE, borderWidth: 10 * scale, borderOpacity: a.op, borderLineCap: 1 })
  }
  page.drawCircle({ x: x + 30 * scale, y: yTopo - 30 * scale, size: 5 * scale, color: VERDE })
}

function wrap(texto: string, font: PDFFont, size: number, maxW: number): string[] {
  const palavras = texto.split(/\s+/)
  const linhas: string[] = []
  let atual = ''
  for (const p of palavras) {
    const tent = atual ? atual + ' ' + p : p
    if (font.widthOfTextAtSize(tent, size) > maxW && atual) { linhas.push(atual); atual = p }
    else atual = tent
  }
  if (atual) linhas.push(atual)
  return linhas
}

export type ListaPdfDados = {
  token: string
  organizador?: string | null
  modelo?: string | null
  codigo?: string | null
}

export async function gerarListaColetaPdf(d: ListaPdfDados): Promise<Uint8Array> {
  const link = linkInscricaoUrl(d.token)
  const doc = await PDFDocument.create()
  doc.setTitle('Coleta de tamanhos — Confeccione')
  doc.setAuthor('Confeccione')
  const reg = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage([A4.w, A4.h])

  // cabeçalho
  desenharLogo(page, MX, TOPO, 0.5)
  page.drawText('CONFECCIONE', { x: MX + 42, y: TOPO - 18, size: 15, font: bold, color: ESCURO })
  page.drawText(SITE, { x: MX + 42, y: TOPO - 32, size: 9, font: reg, color: VERDE })
  page.drawLine({ start: { x: MX, y: TOPO - 46 }, end: { x: A4.w - MX, y: TOPO - 46 }, thickness: 1, color: CINZA_CLARO })

  const maxW = A4.w - MX * 2
  let y = TOPO - 84

  function centro(txt: string, size: number, font: PDFFont, cor = ESCURO, gap = 8) {
    for (const ln of wrap(txt, font, size, maxW)) {
      const w = font.widthOfTextAtSize(ln, size)
      page.drawText(ln, { x: (A4.w - w) / 2, y, size, font, color: cor })
      y -= size + 5
    }
    y -= gap
  }

  centro('Pedido coletivo de camisetas', 20, bold, ESCURO, 4)
  const sub = [d.modelo, d.codigo ? `Pedido nº ${d.codigo}` : null].filter(Boolean).join('  ·  ')
  if (sub) centro(sub, 11, reg, CINZA, 10)

  const intro = d.organizador
    ? `${d.organizador} está montando este pedido pela Confeccione e precisa do seu nome e tamanho.`
    : 'Estamos montando este pedido pela Confeccione e precisamos do seu nome e tamanho.'
  centro(intro, 12.5, reg, rgb(0.25, 0.27, 0.3), 18)

  // QR code centralizado
  const qrDataUrl = await QRCode.toDataURL(link, { margin: 1, width: 600, color: { dark: '#0F6E56', light: '#FFFFFF' } })
  const qrPng = await doc.embedPng(qrDataUrl)
  const qrSize = 210
  const qrX = (A4.w - qrSize) / 2
  const qrY = y - qrSize
  // moldura
  page.drawRectangle({ x: qrX - 14, y: qrY - 14, width: qrSize + 28, height: qrSize + 28, color: rgb(1, 1, 1), borderColor: VERDE, borderWidth: 1.5 })
  page.drawImage(qrPng, { x: qrX, y: qrY, width: qrSize, height: qrSize })
  y = qrY - 34

  centro('Aponte a câmera do celular para o QR Code', 11, reg, CINZA, 6)
  centro('ou acesse:', 10.5, reg, CINZA, 4)
  // link em destaque
  const linkTxt = link.replace(/^https?:\/\//, '')
  const lw = bold.widthOfTextAtSize(linkTxt, 13)
  page.drawRectangle({ x: (A4.w - (lw + 28)) / 2, y: y - 6, width: lw + 28, height: 26, color: rgb(0.882, 0.961, 0.929) })
  page.drawText(linkTxt, { x: (A4.w - lw) / 2, y, size: 13, font: bold, color: VERDE_ESC })
  y -= 46

  // passo a passo
  const passos = [
    '1.  Escaneie o QR Code ou abra o link acima',
    '2.  Informe seu nome e o tamanho da camisa',
    '3.  Pronto! Seu tamanho entra na contagem do pedido',
  ]
  for (const p of passos) {
    page.drawText(p, { x: MX + 8, y, size: 12, font: reg, color: rgb(0.2, 0.22, 0.25) })
    y -= 22
  }

  // rodapé
  const rod = `Pedido montado em ${SITE}`
  const rw = reg.widthOfTextAtSize(rod, 8.5)
  page.drawText(rod, { x: (A4.w - rw) / 2, y: 42, size: 8.5, font: reg, color: CINZA })

  return await doc.save()
}
