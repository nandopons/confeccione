// Gera o PDF "Resumo do pedido" com a marca da Confeccione (logo vetorial + site).
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib'

type MapaMockups = Record<string, { liso?: string; arte?: string; fotos?: string[]; ia?: { url: string; prompt?: string }[] }>

export type LinhaResumo = {
  modelo?: string | null
  cor?: string | null
  material?: string | null
  total?: number | null
  estampado?: boolean | null
  tamanhos?: { tamanho?: string | null; qtd?: number | null }[] | null
  estampas?: { posicao?: string | null; tamanho?: string | null }[] | null
  publico?: string | null
  descricao?: string | null
}

export type ResumoPedido = {
  id: string
  nome?: string | null
  linhas: LinhaResumo[]
  prazoDias?: number | null
  cep?: string | null
  numero?: string | null
  complemento?: string | null
  logradouro?: string | null
  bairro?: string | null
  cidade?: string | null
  uf?: string | null
  codigo?: string | null
  mockups?: MapaMockups | null
  imagens?: string[] | null
}

const VERDE = rgb(0.114, 0.62, 0.459) // #1D9E75
const ESCURO = rgb(0.094, 0.094, 0.094) // #181818
const CINZA = rgb(0.42, 0.45, 0.49)
const CINZA_CLARO = rgb(0.85, 0.87, 0.89)
const SITE = 'confeccione.com.br'

const A4 = { w: 595.28, h: 841.89 }
const MX = 48 // margem horizontal
const TOPO = A4.h - 54
const FUNDO = 70

function corLabel(s?: string | null): string {
  return (s || '').replace(/\s*\(#?[0-9a-fA-F]{6}\)\s*/g, ' ').replace(/#[0-9a-fA-F]{6}/g, '').replace(/\s{2,}/g, ' ').trim()
}
function imagensDoProduto(mockups: MapaMockups | null | undefined, i: number): string[] {
  const m = mockups && typeof mockups === 'object' ? mockups[String(i)] : undefined
  if (!m) return []
  const fotos = Array.isArray(m.fotos) ? m.fotos.filter(Boolean) : []
  const ia = Array.isArray(m.ia) ? m.ia.map((it) => it?.url).filter((x): x is string => typeof x === 'string' && x.length > 0) : []
  if (fotos.length > 0 || ia.length > 0) return [...fotos, ...ia]
  if (m.arte) return [m.arte]
  if (m.liso) return [m.liso]
  return []
}

function qtdDaLinha(l: LinhaResumo): number {
  return typeof l.total === 'number' && l.total > 0 ? l.total : (l.tamanhos || []).reduce((a, t) => a + (t.qtd || 0), 0)
}

// quebra texto em linhas que cabem em maxW
function wrap(texto: string, font: PDFFont, size: number, maxW: number): string[] {
  const palavras = texto.split(/\s+/)
  const linhas: string[] = []
  let atual = ''
  for (const p of palavras) {
    const tent = atual ? atual + ' ' + p : p
    if (font.widthOfTextAtSize(tent, size) > maxW && atual) {
      linhas.push(atual)
      atual = p
    } else {
      atual = tent
    }
  }
  if (atual) linhas.push(atual)
  return linhas
}

// desenha a marca (anel de 4 arcos + ponto) — mesmas paths do header
function desenharLogo(page: PDFPage, x: number, yTopo: number, scale: number) {
  const arcs = [
    { d: 'M30 6 A24 24 0 0 1 54 30', op: 1 },
    { d: 'M54 30 A24 24 0 0 1 30 54', op: 0.5 },
    { d: 'M30 54 A24 24 0 0 1 6 30', op: 0.75 },
    { d: 'M6 30 A24 24 0 0 1 30 6', op: 0.35 },
  ]
  for (const a of arcs) {
    page.drawSvgPath(a.d, {
      x, y: yTopo, scale,
      borderColor: VERDE, borderWidth: 10 * scale, borderOpacity: a.op,
      borderLineCap: 1,
    })
  }
  page.drawCircle({ x: x + 30 * scale, y: yTopo - 30 * scale, size: 5 * scale, color: VERDE })
}

function cabecalho(page: PDFPage, bold: PDFFont, reg: PDFFont) {
  desenharLogo(page, MX, TOPO, 0.5)
  page.drawText('CONFECCIONE', { x: MX + 42, y: TOPO - 18, size: 15, font: bold, color: ESCURO })
  page.drawText(SITE, { x: MX + 42, y: TOPO - 32, size: 9, font: reg, color: VERDE })
  page.drawLine({ start: { x: MX, y: TOPO - 46 }, end: { x: A4.w - MX, y: TOPO - 46 }, thickness: 1, color: CINZA_CLARO })
}

function rodape(page: PDFPage, reg: PDFFont) {
  const txt = `Pedido montado em ${SITE}`
  const w = reg.widthOfTextAtSize(txt, 8.5)
  page.drawText(txt, { x: (A4.w - w) / 2, y: 42, size: 8.5, font: reg, color: CINZA })
}

function dataBR(): string {
  return new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export async function gerarResumoPedidoPdf(pedido: ResumoPedido): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle('Resumo do pedido — Confeccione')
  doc.setAuthor('Confeccione')
  const reg = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  let page = doc.addPage([A4.w, A4.h])
  cabecalho(page, bold, reg)
  rodape(page, reg)
  let y = TOPO - 74
  const maxW = A4.w - MX * 2

  function novaPagina() {
    page = doc.addPage([A4.w, A4.h])
    cabecalho(page, bold, reg)
    rodape(page, reg)
    y = TOPO - 74
  }
  function garantir(espaco: number) {
    if (y - espaco < FUNDO) novaPagina()
  }
  function linha(txt: string, opts: { size?: number; font?: PDFFont; cor?: ReturnType<typeof rgb>; gap?: number; indent?: number } = {}) {
    const size = opts.size ?? 10
    const font = opts.font ?? reg
    const cor = opts.cor ?? CINZA
    const indent = opts.indent ?? 0
    for (const ln of wrap(txt, font, size, maxW - indent)) {
      garantir(size + 4)
      page.drawText(ln, { x: MX + indent, y, size, font, color: cor })
      y -= size + 4
    }
    if (opts.gap) y -= opts.gap
  }

  async function embedDataUrl(dataUrl: string) {
    const m = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl || '')
    if (!m) return null
    const mime = m[1].toLowerCase()
    const bytes = Uint8Array.from(Buffer.from(m[2], 'base64'))
    try {
      if (mime.includes('png')) return await doc.embedPng(bytes)
      if (mime.includes('jpg') || mime.includes('jpeg')) return await doc.embedJpg(bytes)
      try { return await doc.embedPng(bytes) } catch { return await doc.embedJpg(bytes) }
    } catch { return null }
  }

  async function desenharImagens(urls: string[]) {
    const imgs: { im: Awaited<ReturnType<typeof doc.embedPng>> }[] = []
    for (const u of urls) {
      const im = await embedDataUrl(u)
      if (im) imgs.push({ im })
    }
    if (imgs.length === 0) return
    const cellW = 232, cellH = 300, gap = 12
    const porLinha = Math.max(1, Math.floor((maxW + gap) / (cellW + gap)))
    for (let r = 0; r < imgs.length; r += porLinha) {
      const fileira = imgs.slice(r, r + porLinha).map(({ im }) => {
        const sc = Math.min(cellW / im.width, cellH / im.height, 1)
        return { im, w: im.width * sc, h: im.height * sc }
      })
      const rowH = Math.max(...fileira.map((d) => d.h))
      garantir(rowH + 10)
      let x = MX
      for (const d of fileira) {
        page.drawRectangle({ x: x - 1, y: y - d.h - 1, width: d.w + 2, height: d.h + 2, borderColor: CINZA_CLARO, borderWidth: 0.6 })
        page.drawImage(d.im, { x, y: y - d.h, width: d.w, height: d.h })
        x += cellW + gap
      }
      y -= rowH + 10
    }
  }

  // Título
  linha('Resumo do pedido', { size: 18, font: bold, cor: ESCURO, gap: 2 })
  const totalPecas = pedido.linhas.reduce((a, l) => a + qtdDaLinha(l), 0)
  const metaLinha = [
    `Pedido nº ${pedido.codigo || pedido.id.slice(0, 8).toUpperCase()}`,
    `Data: ${dataBR()}`,
    `${totalPecas} ${totalPecas === 1 ? 'peça' : 'peças'} no total`,
  ].join('   ·   ')
  linha(metaLinha, { size: 9.5, cor: CINZA, gap: 6 })
  if (pedido.nome) linha(`Cliente: ${pedido.nome}`, { size: 10, cor: ESCURO, gap: 2 })

  // Endereço de entrega
  const endParte1 = [pedido.logradouro, pedido.numero].filter(Boolean).join(', ')
  const endParte2 = [pedido.bairro, [pedido.cidade, pedido.uf].filter(Boolean).join('/'), pedido.cep ? `CEP ${pedido.cep}` : null, pedido.complemento].filter(Boolean).join(' · ')
  if (endParte1 || endParte2) {
    linha(`Entrega: ${[endParte1, endParte2].filter(Boolean).join(' — ')}`, { size: 9.5, cor: CINZA, gap: 8 })
  } else {
    y -= 4
  }

  page.drawLine({ start: { x: MX, y: y + 2 }, end: { x: A4.w - MX, y: y + 2 }, thickness: 1, color: CINZA_CLARO })
  y -= 12

  // Produtos
  let algumaImagem = false
  for (let i = 0; i < pedido.linhas.length; i++) {
    const l = pedido.linhas[i]
    const qtd = qtdDaLinha(l)
    garantir(70)
    const titulo = `${qtd || '?'}× ${[l.modelo || 'peça', corLabel(l.cor)].filter(Boolean).join(' · ')}`
    linha(titulo, { size: 12, font: bold, cor: ESCURO, gap: 1 })
    if (l.material) linha(`Material: ${l.material}`, { size: 10 })
    const tam = (l.tamanhos || []).filter((t) => t.tamanho).map((t) => `${String(t.tamanho).toUpperCase()}: ${t.qtd ?? '?'}`).join('   ')
    if (tam) linha(`Tamanhos: ${tam}`, { size: 10 })
    const estampado = l.estampado === true || (l.estampas?.length ?? 0) > 0
    linha(`Acabamento: ${estampado ? 'Estampado / bordado' : 'Lisa'}`, { size: 10 })
    if (estampado) {
      const est = (l.estampas || []).map((e) => [e.posicao, e.tamanho].filter(Boolean).join(' ')).filter(Boolean).join(', ')
      if (est) linha(`Estampa: ${est}`, { size: 10 })
    }
    if (l.publico) linha(`Público: ${l.publico}`, { size: 10 })
    if (l.descricao) linha(`Obs.: ${l.descricao}`, { size: 10, cor: ESCURO })
    const imgsProd = imagensDoProduto(pedido.mockups, i)
    if (imgsProd.length > 0) {
      algumaImagem = true
      y -= 2
      linha('Imagens enviadas:', { size: 9, cor: CINZA, gap: 2 })
      await desenharImagens(imgsProd)
    }
    y -= 6
    if (i < pedido.linhas.length - 1) {
      garantir(10)
      page.drawLine({ start: { x: MX, y: y + 2 }, end: { x: A4.w - MX, y: y + 2 }, thickness: 0.6, color: CINZA_CLARO })
      y -= 10
    }
  }

  if (!algumaImagem && Array.isArray(pedido.imagens) && pedido.imagens.length > 0) {
    garantir(30)
    page.drawLine({ start: { x: MX, y: y + 2 }, end: { x: A4.w - MX, y: y + 2 }, thickness: 0.6, color: CINZA_CLARO })
    y -= 12
    linha('Visualizadores enviados', { size: 11, font: bold, cor: ESCURO, gap: 4 })
    await desenharImagens(pedido.imagens.filter((x) => typeof x === 'string'))
  }

  // Rodapé do resumo
  garantir(40)
  y -= 6
  page.drawLine({ start: { x: MX, y: y + 2 }, end: { x: A4.w - MX, y: y + 2 }, thickness: 1, color: CINZA_CLARO })
  y -= 16
  linha(`Total: ${totalPecas} ${totalPecas === 1 ? 'peça' : 'peças'}`, { size: 12, font: bold, cor: VERDE, gap: 2 })
  if (pedido.prazoDias) linha(`Prazo de produção: ${pedido.prazoDias} dias (a partir da confirmação do pagamento).`, { size: 9.5, cor: CINZA })

  return await doc.save()
}
