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
// `fit: cover` + `position: attention`: o sharp escolhe sozinho a região com
// mais informação visual (a peça, normalmente) em vez de cortar pelo centro
// cego. Numa foto horizontal de arara isso salva o recorte.
// ============================================================================

import sharp from 'sharp'

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
export async function normalizarFotoPortfolio(entrada: Buffer): Promise<ImagemNormalizada> {
  const buffer = await sharp(entrada, { failOn: 'none' })
    .rotate() // respeita o EXIF do celular; sem isso, foto de iPhone vem deitada
    .resize(PORTFOLIO_LARGURA, PORTFOLIO_ALTURA, {
      fit: 'cover',
      position: sharp.strategy.attention,
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
