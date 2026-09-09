// app/lib/transcricao.ts
// ============================================================================
// TRANSCRIÇÃO DE ÁUDIO DO WHATSAPP (09/09/2026)
//
// Cliente de confecção manda áudio. É o jeito natural de explicar "quero uma
// camisa gola polo, algodão, umas 50, pro time da empresa" — falar isso leva 8
// segundos e digitar leva dois minutos. Até hoje o Luigi respondia "só consigo
// ler texto, pode me escrever?", que é a máquina obrigando a pessoa a se
// adaptar a ela.
//
// POR QUE GEMINI E NÃO OUTRO
// A GEMINI_API_KEY já está na Vercel (usada no mockup de imagem), o modelo
// aceita áudio nativamente no mesmo endpoint de texto, e o ogg/opus que o
// WhatsApp manda não precisa de conversão. Zero conta nova, zero ffmpeg.
//
// A TRANSCRIÇÃO VAI PARA wa_mensagens.corpo
// Não numa coluna nova: `corpo` é de onde o inbox, o Luigi e o agente de gestão
// já leem. Gravando ali, o áudio vira texto pra todo mundo de uma vez, e
// `tipo` continua 'audio' pra quem quiser saber a origem. Também é o que faz a
// gente pagar a transcrição UMA vez — quem reler a conversa lê o texto pronto.
// ============================================================================

/** Mimes de áudio que o WhatsApp entrega e o Gemini aceita. */
const MIMES_AUDIO = new Set(['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr', 'audio/wav', 'audio/webm'])

/** 15 MB: o WhatsApp corta em 16, e acima disso o request inline do Gemini falha. */
const TAMANHO_MAX = 15 * 1024 * 1024

/**
 * Teto de espera. Isso roda dentro do webhook, ANTES do 200 pra Meta — se o
 * Gemini travar, a Meta reenvia o evento e a mensagem entra duplicada. Melhor
 * desistir da transcrição do que atrasar o webhook.
 */
const TIMEOUT_MS = 8000

const PROMPT =
  'Transcreva este áudio em português do Brasil, literalmente, só o que foi dito. ' +
  'Não resuma, não corrija, não comente, não traduza e não adicione pontuação de leitura ' +
  'que mude o sentido. Responda apenas com a transcrição. ' +
  'Se não houver fala inteligível, responda exatamente: (sem fala)'

/** Só o mime, sem os parâmetros — o WhatsApp manda "audio/ogg; codecs=opus". */
function mimeLimpo(mime: string | null | undefined): string {
  return (mime ?? '').split(';')[0]!.trim().toLowerCase()
}

export function ehAudioTranscritivel(mime: string | null | undefined): boolean {
  return MIMES_AUDIO.has(mimeLimpo(mime))
}

/**
 * Devolve a transcrição, ou null quando não deu — nunca lança.
 *
 * null significa "não temos o texto", e quem chama trata: o Luigi volta a pedir
 * que escrevam. Um erro de transcrição não pode derrubar o recebimento da
 * mensagem.
 */
export async function transcreverAudio(
  audio: ArrayBuffer | Buffer,
  mime: string | null | undefined
): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY
  if (!key) return null

  const tipo = mimeLimpo(mime)
  if (!MIMES_AUDIO.has(tipo)) return null

  const buffer = Buffer.isBuffer(audio) ? audio : Buffer.from(audio)
  if (buffer.byteLength === 0 || buffer.byteLength > TAMANHO_MAX) return null

  const modelo = process.env.GEMINI_AUDIO_MODEL || 'gemini-2.5-flash'
  const controle = new AbortController()
  const relogio = setTimeout(() => controle.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
      {
        method: 'POST',
        signal: controle.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: PROMPT },
                { inline_data: { mime_type: tipo, data: buffer.toString('base64') } },
              ],
            },
          ],
          // temperatura 0: transcrição não é lugar pra criatividade.
          generationConfig: { temperature: 0, maxOutputTokens: 2048 },
        }),
      }
    )

    if (!res.ok) {
      const detalhe = await res.text().catch(() => '')
      console.error('[transcricao] Gemini recusou', { status: res.status, detalhe: detalhe.slice(0, 300) })
      return null
    }

    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const texto = (json.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('')
      .trim()

    if (!texto || texto === '(sem fala)') return null
    return texto
  } catch (e) {
    // AbortError entra aqui: passou dos 8s e a gente seguiu sem transcrição.
    console.error('[transcricao] falhou', { erro: e instanceof Error ? e.message : String(e) })
    return null
  } finally {
    clearTimeout(relogio)
  }
}
