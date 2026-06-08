// app/api/visualizador/mockup/route.ts
// ============================================================================
// POST /api/visualizador/mockup — gera o MOCKUP LISO (sem estampa) de uma linha
// de produto, a partir da descrição que o cliente passou no chat. Uma vista por
// chamada (frente | costas | lateral). Sem provedor configurado, responde 200
// com { disponivel: false } e a UI cai num placeholder.
// ============================================================================

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { gerarImagem } from '@/app/lib/mockup-image'

export const runtime = 'nodejs'

const Vista = z.enum(['frente', 'costas', 'lateral'])

const BodySchema = z.object({
  modelo: z.string().nullable().optional(),
  cor: z.string().nullable().optional(),
  material: z.string().nullable().optional(),
  descricao: z.string().nullable().optional(),
  vista: Vista.default('frente'),
})

const VISTA_TXT: Record<z.infer<typeof Vista>, string> = {
  frente: 'vista de frente (parte da frente da peça)',
  costas: 'vista de costas (parte de trás da peça)',
  lateral: 'vista lateral (perfil da peça)',
}

function montarPrompt(b: z.infer<typeof BodySchema>): string {
  const modelo = b.modelo?.trim() || 'camiseta'
  const cor = b.cor?.trim() || 'branca'
  const material = b.material?.trim()
  const partes = [
    `Foto de produto para e-commerce de uma ${modelo} ${cor}`,
    material ? `em ${material}` : null,
    `LISA, sem nenhuma estampa, sem logo e sem texto`,
    `${VISTA_TXT[b.vista]}`,
    `peça centralizada sobre fundo branco neutro, iluminação de estúdio suave, sombra sutil, alta resolução, realista, estilo catálogo`,
  ].filter(Boolean)
  let prompt = partes.join(', ') + '.'
  if (b.descricao?.trim()) {
    prompt += ` Detalhes do produto (use só o que for visual e ignore quantidades/tamanhos): ${b.descricao.trim()}.`
  }
  prompt += ' Importante: a peça deve aparecer LIMPA, sem qualquer arte aplicada — essa é a base para depois receber a estampa.'
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
  const r = await gerarImagem({ prompt }) // sem imagens de entrada (texto-only)

  if (!r.disponivel) {
    return NextResponse.json({ disponivel: false, motivo: r.motivo, vista: body.data.vista })
  }
  return NextResponse.json({
    disponivel: true,
    vista: body.data.vista,
    imagemDataUrl: `data:${r.mime};base64,${r.imagemBase64}`,
  })
}
