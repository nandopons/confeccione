// app/lib/imagem-no-navegador.ts
// ============================================================================
// REDUZ A FOTO ANTES DE SUBIR — só roda no navegador (usa canvas/FileReader).
//
// Foto de celular tem 3–12 MB. A função da Vercel corta o corpo em 4,5 MB e
// responde 413 em HTML — o `r.json()` do painel quebra e a pessoa vê "falha de
// conexão", sem saber que é o tamanho. O Gustavo Barros (28/09/2026) tentou
// subir o portfólio e viu exatamente isso.
//
// Um lugar só: o editor da oferta já fazia isto inline (25/09) e o portfólio
// não fazia. Qualquer upload de imagem pelo navegador passa por aqui.
// ============================================================================

export const LADO_MAX_UPLOAD = 1600
/** Abaixo disto o arquivo sobe como veio — não vale recomprimir. */
export const BYTES_SEM_REDUZIR = 900_000

function lerComoDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(new Error('não deu pra ler o arquivo'))
    r.readAsDataURL(file)
  })
}

/**
 * Devolve um Blob ≤ `LADO_MAX_UPLOAD` px no maior lado, em JPEG 0.85. Arquivo
 * já pequeno volta como está. Se o navegador não conseguir decodificar (HEIC
 * em navegador antigo, por exemplo), devolve o original — o servidor decide.
 */
export async function reduzirParaUpload(file: File): Promise<Blob> {
  if (file.size <= BYTES_SEM_REDUZIR) return file
  try {
    const dataUrl = await lerComoDataUrl(file)
    const img = document.createElement('img')
    await new Promise<void>((res, rej) => {
      img.onload = () => res()
      img.onerror = () => rej(new Error('imagem inválida'))
      img.src = dataUrl
    })
    const esc = Math.min(1, LADO_MAX_UPLOAD / Math.max(img.naturalWidth || 1, img.naturalHeight || 1))
    const w = Math.max(1, Math.round((img.naturalWidth || 1) * esc))
    const h = Math.max(1, Math.round((img.naturalHeight || 1) * esc))
    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    const cx = cv.getContext('2d')
    if (!cx) return file
    cx.fillStyle = '#ffffff'
    cx.fillRect(0, 0, w, h)
    cx.drawImage(img, 0, 0, w, h)
    const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, 'image/jpeg', 0.85))
    return blob ?? file
  } catch {
    return file
  }
}

/** Nome do arquivo pro FormData: o original se não mexemos, senão .jpg. */
export function nomeParaUpload(original: File, blob: Blob): string {
  return blob === original ? original.name : original.name.replace(/\.[^.]+$/, '') + '.jpg'
}
