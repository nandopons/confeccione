// app/lib/mockup-image.ts
// ============================================================================
// Adaptador PLUGÁVEL de geração de imagem do mockup.
//
// A página /mockup e a rota /api/mockup/gerar não conhecem o provedor: elas só
// chamam gerarMockup(). Trocar/ligar um provedor é mudar APENAS este arquivo +
// variáveis de ambiente.
//
// Seleção por env:
//   MOCKUP_IMAGE_PROVIDER = 'gemini'   -> usa GEMINI_API_KEY (Gemini 2.5 Flash Image)
//   (ausente / outro)                  -> indisponível (a UI mostra o prompt + a
//                                          logo como prévia, sem renderizar)
//
// Para adicionar OpenAI (gpt-image-1) ou fal/Replicate (FLUX Kontext), basta
// criar outra função provider* e referenciá-la no switch.
// ============================================================================

export type ResultadoMockup =
  | { disponivel: false; motivo: string }
  | { disponivel: true; imagemBase64: string; mime: string }

export interface OpcoesMockup {
  prompt: string
  logoBase64: string // base64 puro (sem prefixo data:)
  logoMime: string // ex.: 'image/png'
}

export function provedorConfigurado(): string | null {
  const p = (process.env.MOCKUP_IMAGE_PROVIDER || '').trim().toLowerCase()
  if (p === 'gemini' && process.env.GEMINI_API_KEY) return 'gemini'
  // futuros: 'openai' (OPENAI_API_KEY), 'fal' (FAL_KEY), 'replicate' (REPLICATE_API_TOKEN)
  return null
}

export async function gerarMockup(opts: OpcoesMockup): Promise<ResultadoMockup> {
  const provedor = provedorConfigurado()
  if (!provedor) {
    return {
      disponivel: false,
      motivo:
        'Provedor de imagem ainda não configurado. Defina MOCKUP_IMAGE_PROVIDER e a API key correspondente.',
    }
  }
  if (provedor === 'gemini') return gerarComGemini(opts)
  return { disponivel: false, motivo: `Provedor desconhecido: ${provedor}` }
}

// ----------------------------------------------------------------------------
// Gemini 2.5 Flash Image (aceita imagem de entrada — ideal pra manter a logo)
// ----------------------------------------------------------------------------
async function gerarComGemini(opts: OpcoesMockup): Promise<ResultadoMockup> {
  const key = process.env.GEMINI_API_KEY as string
  const modelo = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${key}`

  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: opts.prompt },
          { inline_data: { mime_type: opts.logoMime, data: opts.logoBase64 } },
        ],
      },
    ],
  }

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

  // Procura o primeiro inline_data (imagem) nas partes da resposta.
  const parts =
    (data as any)?.candidates?.[0]?.content?.parts ?? ([] as any[])
  for (const p of parts) {
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
