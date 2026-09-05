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
// ENQUADRAMENTO (04/09/2026): o corte é DETERMINÍSTICO. A versão original usava
// `sharp.strategy.attention`, que escolhe a região de maior interesse visual —
// numa foto de modelo isso trava no rosto e corta a cabeça, e o resultado muda
// de foto pra foto: impossível de explicar pro fornecedor e impossível de
// corrigir sem sorte.
//
// CORTE LIVRE (05/09/2026): as três âncoras (topo/centro/base) resolviam o
// "cortou a cabeça" e mais nada — peça fora do eixo, foto tirada de lado ou
// peça pequena num quadro grande continuavam sem solução, e não havia zoom.
// Agora a janela de corte anda nos dois eixos (`x`, `y` de 0 a 100) e aperta
// (`zoom`). O padrão continua sendo o topo, porque roupa se fotografa de cima
// pra baixo: cortar a barra é normal, cortar a cabeça não.
//
// A conta aqui é a MESMA que o preview no navegador faz com a imagem crua
// (AjusteFotoModal). Se as duas divergirem, o fornecedor posiciona uma coisa e
// recebe outra — por isso a fórmula está escrita nos dois lugares com os
// mesmos nomes.
// ============================================================================

import sharp from 'sharp'
import { corteValido, CORTE_PADRAO, type Corte } from './portfolio-corte'

// Reexporta pra quem já importava daqui. O tipo e as constantes moram em
// portfolio-corte.ts porque o editor do painel (client component) precisa
// deles — e importar ESTE arquivo no navegador arrastaria o sharp junto.
export { corteValido, corteDoEnquadramento, CORTE_PADRAO, ZOOM_MAX } from './portfolio-corte'
export type { Corte } from './portfolio-corte'
export { ENQUADRAMENTOS, enquadramentoValido } from './portfolio-enquadramento'
export type { Enquadramento } from './portfolio-enquadramento'

export const PORTFOLIO_LARGURA = 1080
export const PORTFOLIO_ALTURA = 1350 // 4:5 retrato


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
  corte: Corte = CORTE_PADRAO,
): Promise<ImagemNormalizada> {
  const { x, y, zoom } = corteValido(corte)

  // rotate() antes de qualquer conta: sem ele a foto de iPhone vem deitada e a
  // janela de corte seria calculada sobre as dimensões erradas.
  const base = sharp(entrada, { failOn: 'none' }).rotate()
  const meta = await base.metadata()
  const L = meta.width ?? 0
  const A = meta.height ?? 0

  let recortada = base
  if (L > 0 && A > 0) {
    // escala = quanto a foto precisa crescer pra COBRIR o quadro 4:5; o zoom
    // multiplica isso, e a janela em pixels da origem encolhe na mesma medida.
    const escala = Math.max(PORTFOLIO_LARGURA / L, PORTFOLIO_ALTURA / A) * zoom
    const janelaL = Math.min(L, Math.max(1, Math.round(PORTFOLIO_LARGURA / escala)))
    const janelaA = Math.min(A, Math.max(1, Math.round(PORTFOLIO_ALTURA / escala)))
    recortada = base.extract({
      left: Math.round((L - janelaL) * (x / 100)),
      top: Math.round((A - janelaA) * (y / 100)),
      width: janelaL,
      height: janelaA,
    })
  }

  const buffer = await recortada
    // A janela já sai na proporção certa (a menos de 1px de arredondamento);
    // o cover aqui só acerta esse resto.
    .resize(PORTFOLIO_LARGURA, PORTFOLIO_ALTURA, { fit: 'cover', withoutEnlargement: false })
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

  // Sangrado: NÃO redimensiona nem recentraliza — devolve a peça exatamente
  // onde ela estava no quadro original. O recorte já veio de uma imagem
  // 1080x1350, então basta recolar no mesmo offset e trocar o fundo. Qualquer
  // resize aqui vira margem em algum lado (foi o "no top ainda tá").
  const escalaX = PORTFOLIO_LARGURA / larguraOriginal
  const escalaY = PORTFOLIO_ALTURA / alturaOriginal

  const sobreposicao = sangrado
    ? {
        input: await sharp(recortado)
          .resize(Math.max(1, Math.round(info.width * escalaX)), Math.max(1, Math.round(info.height * escalaY)), {
            fit: 'fill',
          })
          .toBuffer(),
        left: Math.max(0, Math.round(cortadoEsquerda * escalaX)),
        top: Math.max(0, Math.round(cortadoTopo * escalaY)),
      }
    : {
        // Peça solta (cabide, produto inteiro): aí sim vale padronizar —
        // centraliza com respiro nos quatro lados, como e-commerce faz.
        input: await sharp(recortado)
          .resize(Math.round(PORTFOLIO_LARGURA * 0.88), Math.round(PORTFOLIO_ALTURA * 0.88), {
            fit: 'inside',
            withoutEnlargement: false,
          })
          .toBuffer(),
        gravity: 'centre' as const,
      }

  const buffer = await sharp({
    create: {
      width: PORTFOLIO_LARGURA,
      height: PORTFOLIO_ALTURA,
      channels: 4,
      background: { ...FUNDO_VITRINE, alpha: 1 },
    },
  })
    .composite([sobreposicao])
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
