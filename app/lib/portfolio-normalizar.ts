// app/lib/portfolio-normalizar.ts
// ============================================================================
// Normalização da foto de portfólio do fornecedor (03/09/2026).
//
// Decisão de produto: o fornecedor NÃO precisa saber de tamanho, proporção nem
// formato. Ele manda a foto do jeito que tirou (celular na vertical, print,
// foto de estúdio na horizontal) e o sistema devolve sempre o mesmo formato.
// Sem isso, o carrossel da home vira uma colcha de retalhos — que foi
// exatamente o problema da grade de texto que este recurso substituiu.
//
// Formato escolhido: RETRATO 4:5 (1080x1350). É o padrão de e-commerce de moda
// e de Instagram: mostra a peça inteira no corpo sem cortar cabeça/barra, e
// ocupa bem a tela do celular, que é de onde vem a maioria dos acessos.
//
// ENQUADRAMENTO (revisto em 04/09/2026): o corte é DETERMINÍSTICO, ancorado no
// topo por padrão. A versão anterior usava `sharp.strategy.attention`, que
// escolhe a região de maior interesse visual — numa foto de modelo isso trava
// no rosto e corta a cabeça, e o pior é que o resultado muda de foto pra foto:
// impossível de explicar pro fornecedor e impossível de corrigir sem sorte.
// Roupa se fotografa de cima pra baixo; cortar a barra é normal, cortar a
// cabeça não. Quem quiser outro corte escolhe centro ou base no painel.
// ============================================================================

import sharp from 'sharp'

export const PORTFOLIO_LARGURA = 1080
export const PORTFOLIO_ALTURA = 1350 // 4:5 retrato

/** De onde o corte 4:5 parte. É o que o fornecedor escolhe no painel. */
export type Enquadramento = 'topo' | 'centro' | 'base'

export const ENQUADRAMENTOS: Enquadramento[] = ['topo', 'centro', 'base']

export function enquadramentoValido(v: unknown): Enquadramento {
  return ENQUADRAMENTOS.includes(v as Enquadramento) ? (v as Enquadramento) : 'topo'
}

const GRAVIDADE: Record<Enquadramento, string> = {
  topo: 'north',
  centro: 'centre',
  base: 'south',
}

export type ImagemNormalizada = {
  buffer: Buffer
  mime: string
  extensao: string
  largura: number
  altura: number
}

/**
 * Recebe os bytes crus enviados pelo fornecedor e devolve um JPEG 1080x1350.
 *
 * Diferente de `normalizarMockup`, aqui a falha NÃO é silenciosa: se a imagem
 * não abre, é porque o arquivo não é uma imagem válida (ou está corrompido) e
 * o fornecedor precisa saber disso na hora do upload — publicar um arquivo
 * quebrado na vitrine seria pior do que recusar.
 */
export async function normalizarFotoPortfolio(
  entrada: Buffer,
  enquadramento: Enquadramento = 'topo',
): Promise<ImagemNormalizada> {
  const buffer = await sharp(entrada, { failOn: 'none' })
    .rotate() // respeita o EXIF do celular; sem isso, foto de iPhone vem deitada
    .resize(PORTFOLIO_LARGURA, PORTFOLIO_ALTURA, {
      fit: 'cover',
      position: GRAVIDADE[enquadramento],
      withoutEnlargement: false,
    })
    .flatten({ background: { r: 255, g: 255, b: 255 } }) // PNG com transparência
    .jpeg({ quality: 82, progressive: true, mozjpeg: true })
    .toBuffer()

  return {
    buffer,
    mime: 'image/jpeg',
    extensao: 'jpg',
    largura: PORTFOLIO_LARGURA,
    altura: PORTFOLIO_ALTURA,
  }
}

/** Cinza claro da vitrine. Escolhido em vez do branco puro porque boa parte das
 *  peças é branca/off-white: contra fundo branco elas perdem o contorno. */
export const FUNDO_VITRINE = { r: 245, g: 246, b: 247 }

/**
 * Compõe um recorte PNG (com transparência) sobre o fundo padrão da vitrine, no
 * mesmo 1080x1350 das demais fotos.
 *
 * DOIS CASOS, e confundir os dois foi o bug de 04/09/2026:
 *
 * a) Recorte SANGRADO — o assunto encosta na borda de baixo do quadro, que é o
 *    caso normal de foto de modelo cortada na cintura. O corte reto do jeans faz
 *    parte do enquadramento da foto, não da peça. Centralizar isso com 12% de
 *    respiro joga o corte reto pro MEIO do quadro (vira uma amputação visível) e
 *    ainda encolhe a peça — foi o "cortou embaixo e perdeu o zoom".
 *    Solução: manter o sangramento. Ancora embaixo, encostando na borda, e deixa
 *    o respiro só no topo. O corte reto some na moldura.
 *
 * b) Recorte SOLTO — peça em cabide, produto fotografado inteiro. Aí sim vale
 *    centralizar com respiro dos quatro lados, que é o padrão de e-commerce.
 */
export async function comporSobreFundo(recortePng: Buffer): Promise<ImagemNormalizada> {
  const original = await sharp(recortePng).metadata()

  // trim() devolve, no info, o quanto foi cortado de cada lado — é com isso que
  // dá pra saber se o assunto encostava na borda ou boiava no meio.
  const { data: recortado, info } = await sharp(recortePng)
    .trim()
    .toBuffer({ resolveWithObject: true })

  const larguraOriginal = original.width ?? info.width
  const alturaOriginal = original.height ?? info.height
  const cortadoEsquerda = -(info.trimOffsetLeft ?? 0)
  const cortadoTopo = -(info.trimOffsetTop ?? 0)
  // 1.5% de folga: a máscara raramente encosta na borda no pixel exato.
  const folga = Math.round(alturaOriginal * 0.015)
  const encostaEmbaixo = cortadoTopo + info.height >= alturaOriginal - folga
  const encostaNaLateral =
    cortadoEsquerda <= folga || cortadoEsquerda + info.width >= larguraOriginal - folga

  const sangrado = encostaEmbaixo || encostaNaLateral

  const dentro = sangrado
    ? // Ocupa a altura quase toda; o respiro fica no topo, pela gravidade south.
      await sharp(recortado)
        .resize(Math.round(PORTFOLIO_LARGURA * 0.98), Math.round(PORTFOLIO_ALTURA * 0.97), {
          fit: 'inside',
          withoutEnlargement: false,
        })
        .toBuffer()
    : await sharp(recortado)
        .resize(Math.round(PORTFOLIO_LARGURA * 0.88), Math.round(PORTFOLIO_ALTURA * 0.88), {
          fit: 'inside',
          withoutEnlargement: false,
        })
        .toBuffer()

  const buffer = await sharp({
    create: {
      width: PORTFOLIO_LARGURA,
      height: PORTFOLIO_ALTURA,
      channels: 4,
      background: { ...FUNDO_VITRINE, alpha: 1 },
    },
  })
    .composite([{ input: dentro, gravity: sangrado ? 'south' : 'centre' }])
    .flatten({ background: FUNDO_VITRINE })
    .jpeg({ quality: 82, progressive: true, mozjpeg: true })
    .toBuffer()

  return {
    buffer,
    mime: 'image/jpeg',
    extensao: 'jpg',
    largura: PORTFOLIO_LARGURA,
    altura: PORTFOLIO_ALTURA,
  }
}
