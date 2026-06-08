// app/lib/imagem-normalizar.ts
// ============================================================================
// Normaliza QUALQUER imagem de mockup (gerada pelo Gemini ou enviada no admin)
// para o tamanho PADRÃO fixo, com fundo branco. Garante que tudo no repositório
// e no visualizador tenha exatamente as mesmas dimensões — independente da
// origem. Usa sharp (fit: contain → nunca corta; sobra vira branco).
// ============================================================================

import sharp from 'sharp'

export const MOCKUP_LARGURA = 2048
export const MOCKUP_ALTURA = 878 // ~21:9

/** Recebe um data URL (qualquer formato), devolve um data URL JPEG no tamanho
 *  padrão (MOCKUP_LARGURA x MOCKUP_ALTURA), centralizado sobre fundo branco.
 *  Em qualquer falha, devolve o data URL original (não quebra o fluxo). */
export async function normalizarMockup(dataUrl: string): Promise<string> {
  const m = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl?.trim() ?? '')
  if (!m) return dataUrl
  try {
    const buf = Buffer.from(m[2], 'base64')
    const out = await sharp(buf)
      .resize(MOCKUP_LARGURA, MOCKUP_ALTURA, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255 },
      })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality: 88 })
      .toBuffer()
    return `data:image/jpeg;base64,${out.toString('base64')}`
  } catch (err) {
    console.error('[imagem-normalizar] falhou, mantendo original:', err)
    return dataUrl
  }
}
