// app/api/visualizador/mockup/route.ts
// ============================================================================
// POST /api/visualizador/mockup — gera (ou REUTILIZA) o MOCKUP LISO de uma linha
// de produto. UMA imagem panorâmica com as 3 vistas (frente, lateral, costas).
//
// CACHE: mockups de peça lisa são reaproveitados entre produtos iguais/similares.
// A chave é modelo|cor|material normalizado (sem acento, minúsculo, espaços
// colapsados). Se já existe no cache (tabela mockups_lisos), devolve na hora —
// sem chamar o Gemini. Senão gera, grava no cache e devolve.
//
// Sem provedor configurado e sem cache, responde 200 com { disponivel:false }.
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { gerarImagem } from '@/app/lib/mockup-image'
import { chaveMockup, normMockup } from '@/app/lib/mockup-cache'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BodySchema = z.object({
  modelo: z.string().nullable().optional(),
  cor: z.string().nullable().optional(),
  material: z.string().nullable().optional(),
  descricao: z.string().nullable().optional(),
  vista: z.string().optional(), // retrocompat, ignorado
  forcar: z.boolean().optional(), // ignora o cache e regenera
})

// chave de cache vem do lib compartilhado (mesma usada pelo painel admin):
// modelo|cor|material normalizado. Descrição NÃO entra — permite reuso entre
// produtos "similares".
function cacheavel(b: z.infer<typeof BodySchema>): boolean {
  // só cacheia quando há identidade mínima (modelo + cor)
  return normMockup(b.modelo).length > 0 && normMockup(b.cor).length > 0
}

function montarPrompt(b: z.infer<typeof BodySchema>): string {
  const modelo = b.modelo?.trim() || 'camiseta'
  const cor = b.cor?.trim() || 'branca'
  const material = b.material?.trim()
  let prompt =
    `Foto de catálogo de e-commerce mostrando A MESMA ${modelo} na cor ${cor}` +
    (material ? `, em ${material}` : '') +
    `, LISA — sem nenhuma estampa, sem logo e sem texto. ` +
    `Gere UMA ÚNICA imagem panorâmica (orientação paisagem, proporção aproximada 16:7) com TRÊS ângulos da peça lado a lado, na ordem: ` +
    `FRENTE à esquerda, VISTA LATERAL (perfil) ao centro e COSTAS à direita. ` +
    `A peça é vestida por um modelo (enquadramento do pescoço até os quadris), as três tomadas com o MESMO modelo, mesma cor e mesmo tecido, ` +
    `fundo branco liso e uniforme, iluminação de estúdio suave, sombras sutis, alta resolução, realista, estilo lookbook de produto.`
  if (b.descricao?.trim()) {
    prompt += ` Detalhes visuais do produto (ignore quantidades e tamanhos): ${b.descricao.trim()}.`
  }
  prompt += ' IMPORTANTE: a peça deve aparecer totalmente LIMPA, sem qualquer arte aplicada — esta é a base que depois vai receber a estampa.'
  return prompt
}

export async function POST(req: Request) {
  let bruto: unknown
  try {
    bruto = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido no corpo.' }, { status: 400 })
  }

  const body = BodySchema.safeParse(bruto)
  if (!body.success) {
    return NextResponse.json({ error: 'Formato inválido.' }, { status: 400 })
  }

  const chave = chaveMockup(body.data.modelo, body.data.cor, body.data.material)
  const podeCachear = cacheavel(body.data)

  // 1) tenta o cache (a menos que forcar)
  if (podeCachear && !body.data.forcar) {
    try {
      const { data } = await supabase
        .from('mockups_lisos')
        .select('imagem_data_url')
        .eq('chave', chave)
        .maybeSingle()
      if (data?.imagem_data_url) {
        return NextResponse.json({ disponivel: true, imagemDataUrl: data.imagem_data_url, cache: true })
      }
    } catch {
      // cache miss / erro de leitura → segue pra geração
    }
  }

  // 2) gera
  const prompt = montarPrompt(body.data)
  const r = await gerarImagem({ prompt })

  if (!r.disponivel) {
    return NextResponse.json({ disponivel: false, motivo: r.motivo })
  }

  const imagemDataUrl = `data:${r.mime};base64,${r.imagemBase64}`

  // 3) grava no cache (upsert). PRECISA ser awaited: em serverless a função é
  // congelada ao retornar, então um write "fire-and-forget" não completaria.
  if (podeCachear) {
    try {
      await supabase.from('mockups_lisos').upsert(
        {
          chave,
          modelo: normMockup(body.data.modelo) || null,
          cor: normMockup(body.data.cor) || null,
          material: normMockup(body.data.material) || null,
          imagem_data_url: imagemDataUrl,
          criado_em: new Date().toISOString(),
        },
        { onConflict: 'chave' }
      )
    } catch {
      // falha de cache não pode quebrar a resposta
    }
  }

  return NextResponse.json({ disponivel: true, imagemDataUrl, cache: false })
}
