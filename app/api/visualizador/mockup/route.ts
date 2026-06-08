// app/api/visualizador/mockup/route.ts
// ============================================================================
// POST /api/visualizador/mockup — gera o MOCKUP LISO (sem estampa) de uma linha
// de produto, a partir da descrição que o cliente passou no chat. UMA ÚNICA
// imagem panorâmica com as TRÊS vistas lado a lado (frente, lateral, costas) da
// mesma peça. Sem provedor configurado, responde 200 com { disponivel:false }.
// ============================================================================

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { gerarImagem } from '@/app/lib/mockup-image'

export const runtime = 'nodejs'

const BodySchema = z.object({
  modelo: z.string().nullable().optional(),
  cor: z.string().nullable().optional(),
  material: z.string().nullable().optional(),
  descricao: z.string().nullable().optional(),
  // aceito por retrocompat, mas ignorado: agora geramos as 3 vistas numa imagem só
  vista: z.string().optional(),
})

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

  const prompt = montarPrompt(body.data)
  const r = await gerarImagem({ prompt }) // texto-only

  if (!r.disponivel) {
    return NextResponse.json({ disponivel: false, motivo: r.motivo })
  }
  return NextResponse.json({
    disponivel: true,
    imagemDataUrl: `data:${r.mime};base64,${r.imagemBase64}`,
  })
}
