// Gera o PDF "Resumo do pedido" com a marca da Confeccione (logo vetorial + site).
import { PDFDocument, StandardFonts, rgb, PDFName, PDFString, type PDFPage, type PDFFont } from 'pdf-lib'

type MapaMockups = Record<string, { liso?: string; arte?: string; fotos?: string[]; ia?: { url: string; prompt?: string }[] }>

export type LinhaResumo = {
  modelo?: string | null
  cor?: string | null
  material?: string | null
  total?: number | null
  estampado?: boolean | null
  acabamentos?: string[] | null
  tamanhos?: { tamanho?: string | null; qtd?: number | null }[] | null
  estampas?: { posicao?: string | null; tamanho?: string | null }[] | null
  publico?: string | null
  objetivo_material?: string | null
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
const VERDE_ESC = rgb(0.059, 0.431, 0.337) // #0F6E56
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
    // Caixa máxima por imagem; a imagem aparece INTEIRA (contain), sem recorte,
    // preservando a proporção original do mockup enviado pelo cliente.
    const box = 200, gap = 12
    const porLinha = Math.max(1, Math.floor((maxW + gap) / (box + gap)))
    for (let r = 0; r < imgs.length; r += porLinha) {
      const fileira = imgs.slice(r, r + porLinha)
      // altura real desta fileira = maior altura entre as imagens (contain)
      const alturas = fileira.map(({ im }) => {
        const sc = Math.min(box / im.width, box / im.height)
        return im.height * sc
      })
      const alturaFileira = Math.max(...alturas)
      garantir(alturaFileira + 10)
      let x = MX
      for (const { im } of fileira) {
        const sc = Math.min(box / im.width, box / im.height) // contain
        const w = im.width * sc, h = im.height * sc
        // alinha pelo topo da fileira e centraliza na largura da caixa
        const ix = x + (box - w) / 2
        const iy = y - h
        page.drawImage(im, { x: ix, y: iy, width: w, height: h })
        // borda acompanha a imagem real (sem moldura vazia ao redor)
        page.drawRectangle({ x: ix, y: iy, width: w, height: h, borderColor: CINZA_CLARO, borderWidth: 0.6 })
        x += box + gap
      }
      y -= alturaFileira + 12
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

  // Callout destacado: acompanhe o pedido pelo painel (clicável).
  {
    const url = `https://${SITE}/cliente/painel`
    const boxH = 50
    garantir(boxH + 8)
    const top = y
    const bottom = y - boxH
    // fundo verde claro + barra de destaque à esquerda
    page.drawRectangle({ x: MX, y: bottom, width: maxW, height: boxH, color: rgb(0.882, 0.961, 0.933) })
    page.drawRectangle({ x: MX, y: bottom, width: 4, height: boxH, color: VERDE_ESC })
    const ix = MX + 16
    page.drawText('Acompanhe e visualize seu pedido', { x: ix, y: top - 19, size: 11.5, font: bold, color: VERDE_ESC })
    const pre = 'Acesse seu painel: '
    page.drawText(pre, { x: ix, y: top - 35, size: 10, font: reg, color: CINZA })
    const preW = reg.widthOfTextAtSize(pre, 10)
    const label = `${SITE}/cliente/painel`
    page.drawText(label, { x: ix + preW, y: top - 35, size: 10, font: bold, color: VERDE })
    const linkW = bold.widthOfTextAtSize(label, 10)
    // a caixa inteira é clicável
    const annot = doc.context.obj({
      Type: 'Annot', Subtype: 'Link',
      Rect: [MX, bottom, MX + maxW, top],
      Border: [0, 0, 0],
      A: doc.context.obj({ Type: 'Action', S: 'URI', URI: PDFString.of(url) }),
    })
    const ref = doc.context.register(annot)
    const existentes = page.node.Annots()
    if (existentes) existentes.push(ref)
    else page.node.set(PDFName.of('Annots'), doc.context.obj([ref]))
    void linkW
    y -= boxH + 14
  }

  page.drawLine({ start: { x: MX, y: y + 2 }, end: { x: A4.w - MX, y: y + 2 }, thickness: 1, color: CINZA_CLARO })
  y -= 12

  // Produtos
  let algumaImagem = false
  for (let i = 0; i < pedido.linhas.length; i++) {
    const l = pedido.linhas[i]
    const qtd = qtdDaLinha(l)
    garantir(96)
    // Faixa "Modelo N" (igual à página do pedido).
    {
      const barH = 20
      page.drawRectangle({ x: MX, y: y - barH + 4, width: maxW, height: barH, color: VERDE_ESC })
      page.drawText(`Modelo ${i + 1}`, { x: MX + 10, y: y - barH + 4 + (barH - 9) / 2, size: 10, font: bold, color: rgb(1, 1, 1) })
      const sub = [l.modelo, corLabel(l.cor)].filter(Boolean).join(' · ')
      if (sub) {
        const subW = reg.widthOfTextAtSize(sub, 9)
        page.drawText(sub, { x: A4.w - MX - 10 - subW, y: y - barH + 4 + (barH - 8) / 2, size: 9, font: reg, color: rgb(0.9, 0.96, 0.93) })
      }
      y -= barH + 12
    }
    const titulo = `${qtd || '?'}× ${[l.modelo || 'peça', corLabel(l.cor)].filter(Boolean).join(' · ')}`
    linha(titulo, { size: 12, font: bold, cor: ESCURO, gap: 1 })
    const OBJ_LABEL: Record<string, string> = { economica: 'Econômica', padrao: 'Padrão', premium: 'Premium', performance: 'Performance / Dry', indefinido: 'A definir (cliente pediu sugestão)' }
    const tecido = [OBJ_LABEL[(l.objetivo_material || '').trim()], l.material].filter(Boolean).join(' · ')
    if (tecido) linha(`Tecido: ${tecido}`, { size: 10 })
    const tam = (l.tamanhos || []).filter((t) => t.tamanho).map((t) => `${String(t.tamanho).toUpperCase()}: ${t.qtd ?? '?'}`).join('   ')
    if (tam) linha(`Tamanhos: ${tam}`, { size: 10 })
    const estampado = l.estampado === true || (l.estampas?.length ?? 0) > 0
    const acab = Array.isArray(l.acabamentos) ? l.acabamentos : []
    const acabTxt = acab.length > 0 ? acab.map((x) => (x === 'bordada' ? 'Bordada' : 'Estampada')).join(' + ') : (estampado ? 'Estampado / bordado' : 'Lisa')
    linha(`Acabamento: ${acabTxt}`, { size: 10 })
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
