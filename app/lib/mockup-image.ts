// app/lib/mockup-image.ts
// ============================================================================
// Adaptador PLUGÁVEL de geração de imagem.
//
// As rotas não conhecem o provedor: chamam gerarImagem({prompt, imagens}).
// `imagens` pode ter 0..N entradas:
//   - 0 imagens   -> geração só por texto (ex.: mockup de produto liso)
//   - 1+ imagens  -> edição/composição (ex.: base do mockup + artes do cliente)
//
// Seleção por env:
//   MOCKUP_IMAGE_PROVIDER = 'gemini'  -> usa GEMINI_API_KEY (Gemini image)
//   (ausente / outro)                 -> indisponível (UI cai em placeholder)
//
// Trocar/ligar provedor = mudar APENAS este arquivo + env.
// ============================================================================

export interface ImagemEntrada {
  base64: string // base64 puro (sem prefixo data:)
  mime: string // ex.: 'image/png'
}

export type ResultadoImagem =
  | { disponivel: false; motivo: string }
  | { disponivel: true; imagemBase64: string; mime: string }

// Retrocompat com a página /mockup antiga
export type ResultadoMockup = ResultadoImagem
export interface OpcoesMockup {
  prompt: string
  logoBase64: string
  logoMime: string
}

export function provedorConfigurado(): string | null {
  const p = (process.env.MOCKUP_IMAGE_PROVIDER || '').trim().toLowerCase()
  if (p === 'gemini' && process.env.GEMINI_API_KEY) return 'gemini'
  // futuros: 'openai' (OPENAI_API_KEY), 'fal' (FAL_KEY), 'replicate' (REPLICATE_API_TOKEN)
  return null
}

export async function gerarImagem(opts: {
  prompt: string
  imagens?: ImagemEntrada[]
}): Promise<ResultadoImagem> {
  const provedor = provedorConfigurado()
  if (!provedor) {
    return {
      disponivel: false,
      motivo:
        'Provedor de imagem ainda não configurado. Defina MOCKUP_IMAGE_PROVIDER=gemini e GEMINI_API_KEY.',
    }
  }
  if (provedor === 'gemini') return gerarComGemini(opts.prompt, opts.imagens ?? [])
  return { disponivel: false, motivo: `Provedor desconhecido: ${provedor}` }
}

// Retrocompat: a rota /api/mockup/gerar continua chamando gerarMockup.
export async function gerarMockup(opts: OpcoesMockup): Promise<ResultadoImagem> {
  return gerarImagem({
    prompt: opts.prompt,
    imagens: [{ base64: opts.logoBase64, mime: opts.logoMime }],
  })
}

// ----------------------------------------------------------------------------
// Gemini (aceita imagens de entrada — ideal pra manter base do mockup + artes)
// ----------------------------------------------------------------------------
async function gerarComGemini(prompt: string, imagens: ImagemEntrada[]): Promise<ResultadoImagem> {
  const key = process.env.GEMINI_API_KEY as string
  const modelo = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${key}`

  const parts: Array<Record<string, unknown>> = [{ text: prompt }]
  for (const img of imagens) {
    parts.push({ inline_data: { mime_type: img.mime, data: img.base64 } })
  }

  const body = { contents: [{ role: 'user', parts }] }

  let resp: Response
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.error('[mockup-image/gemini] erro de rede:', err)
    return { disponivel: false, motivo: 'Falha de rede ao gerar a imagem.' }
  }

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '')
    console.error('[mockup-image/gemini] HTTP', resp.status, txt.slice(0, 500))
    return { disponivel: false, motivo: `Provedor retornou erro (${resp.status}).` }
  }

  let data: unknown
  try {
    data = await resp.json()
  } catch {
    return { disponivel: false, motivo: 'Resposta inválida do provedor.' }
  }

  const respParts =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (data as any)?.candidates?.[0]?.content?.parts ?? ([] as unknown[])
  for (const p of respParts) {
    const inline = p?.inline_data ?? p?.inlineData
    if (inline?.data) {
      return {
        disponivel: true,
        imagemBase64: inline.data as string,
        mime: (inline.mime_type ?? inline.mimeType ?? 'image/png') as string,
      }
    }
  }
  return { disponivel: false, motivo: 'O provedor não retornou imagem.' }
}
