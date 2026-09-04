// app/lib/remover-fundo.ts
// ============================================================================
// Adaptador PLUGÁVEL de recorte de fundo, no mesmo espírito de mockup-image.ts:
// as rotas chamam `removerFundo(buffer)` e não conhecem o provedor.
//
// Seleção por env:
//   REMOVE_FUNDO_PROVIDER = 'removebg'  -> REMOVE_BG_API_KEY
//   REMOVE_FUNDO_PROVIDER = 'photoroom' -> PHOTOROOM_API_KEY
//   (ausente / outro)                   -> indisponível (o botão some da UI)
//
// POR QUE RECORTE POR MÁSCARA E NÃO GERAÇÃO DE IMAGEM
// ---------------------------------------------------------------------------
// O projeto já tem um gerador de imagem configurado (Gemini, em mockup-image.ts)
// e ele até "removeria o fundo" se pedissem. Mas gerador REGENERA os pixels:
// pode mudar a estampa, o caimento, o tom da peça. Aqui a foto é prova do que o
// fornecedor produz e o cliente pede o que viu — alterar a peça é risco de
// briga no pedido. Os dois provedores abaixo devolvem a MESMA foto com o fundo
// recortado por máscara, sem inventar pixel.
// ============================================================================

export type ResultadoFundo =
  | { ok: false; motivo: string }
  | { ok: true; png: Buffer }

export function provedorFundoConfigurado(): 'removebg' | 'photoroom' | null {
  const p = (process.env.REMOVE_FUNDO_PROVIDER || '').trim().toLowerCase()
  if (p === 'removebg' && process.env.REMOVE_BG_API_KEY) return 'removebg'
  if (p === 'photoroom' && process.env.PHOTOROOM_API_KEY) return 'photoroom'
  return null
}

/** Recorta o fundo e devolve PNG com transparência (a composição é do chamador). */
export async function removerFundo(imagem: Buffer, mime = 'image/jpeg'): Promise<ResultadoFundo> {
  const provedor = provedorFundoConfigurado()
  if (!provedor) return { ok: false, motivo: 'recorte de fundo não está configurado' }

  try {
    return provedor === 'removebg'
      ? await viaRemoveBg(imagem, mime)
      : await viaPhotoroom(imagem, mime)
  } catch (e) {
    console.error('[remover-fundo] falhou:', e)
    return { ok: false, motivo: 'o serviço de recorte não respondeu' }
  }
}

async function viaRemoveBg(imagem: Buffer, mime: string): Promise<ResultadoFundo> {
  const form = new FormData()
  form.append('image_file', new Blob([new Uint8Array(imagem)], { type: mime }), 'foto.jpg')
  form.append('size', 'auto')
  // 'product' orienta o modelo pra objeto/roupa em vez de rosto — melhora o
  // recorte de peça em cabide, que é metade do caso de uso aqui.
  form.append('type', 'product')

  const r = await fetch('https://api.remove.bg/v1.0/removebg', {
    method: 'POST',
    headers: { 'X-Api-Key': process.env.REMOVE_BG_API_KEY as string },
    body: form,
  })

  if (!r.ok) {
    const texto = await r.text().catch(() => '')
    return { ok: false, motivo: mensagemDeErro(r.status, texto) }
  }
  return { ok: true, png: Buffer.from(await r.arrayBuffer()) }
}

async function viaPhotoroom(imagem: Buffer, mime: string): Promise<ResultadoFundo> {
  const form = new FormData()
  form.append('image_file', new Blob([new Uint8Array(imagem)], { type: mime }), 'foto.jpg')
  form.append('format', 'png')

  const r = await fetch('https://sdk.photoroom.com/v1/segment', {
    method: 'POST',
    headers: { 'x-api-key': process.env.PHOTOROOM_API_KEY as string },
    body: form,
  })

  if (!r.ok) {
    const texto = await r.text().catch(() => '')
    return { ok: false, motivo: mensagemDeErro(r.status, texto) }
  }
  return { ok: true, png: Buffer.from(await r.arrayBuffer()) }
}

/** Erro do provedor traduzido pro que o fornecedor precisa fazer. */
function mensagemDeErro(status: number, corpo: string): string {
  if (status === 402 || status === 429) {
    // Crédito acabou / limite. O fornecedor não pode resolver isso — a foto
    // dele continua publicada sem recorte e o admin é quem precisa saber.
    console.error('[remover-fundo] crédito/limite do provedor:', status, corpo)
    return 'o recorte automático está indisponível no momento — sua foto continua publicada normalmente'
  }
  if (status === 400) return 'não consegui identificar a peça nessa foto'
  return 'não consegui recortar o fundo agora'
}
