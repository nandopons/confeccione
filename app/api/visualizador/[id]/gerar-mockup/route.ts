// POST /api/visualizador/[id]/gerar-mockup
// Gera (ou ajusta) um MOCKUP com IA pra um produto do pedido, usando as artes
// que o cliente já subiu + as definições do modelo + as instruções livres do
// cliente (onde/como aplicar a logo, cor etc.). É ADITIVO: guarda em
// mockups[index].ia[] sem mexer nas fotos. Público por uuid do pedido.
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { gerarImagem, type ImagemEntrada } from '@/app/lib/mockup-image'
import { normalizarMockup } from '@/app/lib/imagem-normalizar'

export const runtime = 'nodejs'
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const MAX_IA = 4
const Body = z.object({
  index: z.number().int().min(0).max(199),
  instrucoes: z.string().max(2000).optional().default(''),
  regenIaIndex: z.number().int().min(0).max(50).nullable().optional(),
})

type IAItem = { url: string; prompt?: string }
type Mockup = { liso?: string; arte?: string; fotos?: string[]; ia?: IAItem[] }
type Mapa = Record<string, Mockup>
type Linha = {
  modelo?: string | null; cor?: string | null; material?: string | null
  total?: number | null; tamanhos?: { tamanho?: string | null; qtd?: number | null }[] | null
  estampas?: { posicao?: string | null; tamanho?: string | null }[] | null
  estampado?: boolean | null; objetivo_material?: string | null; descricao?: string | null
}

function parseDataUrl(d: string): ImagemEntrada | null {
  const m = /^data:([^;,]+);base64,(.+)$/.exec((d || '').trim())
  return m ? { mime: m[1], base64: m[2] } : null
}
function corLimpa(s?: string | null): string {
  return (s || '').replace(/\s*\(#?[0-9a-fA-F]{6}\)\s*/g, ' ').replace(/#[0-9a-fA-F]{6}/g, '').replace(/\s{2,}/g, ' ').trim()
}
function ehPlaceholder(v?: string | null): boolean {
  const t = (v || '').trim().toLowerCase()
  if (!t) return true
  return /(a\s*definir|a\s*combinar|\bdefinir\b|indefinid|private\s*label|sob\s*consulta|^n\/?a$|^-+$)/.test(t)
}
const MATERIAL_OBJ: Record<string, string> = {
  economica: 'malha básica (algodão básico/PV)',
  padrao: 'algodão fio 30 penteado',
  premium: 'algodão premium (pima/penteado nobre)',
  performance: 'dry-fit / poliamida',
  indefinido: '',
}
function materialDaLinha(l: Linha): string {
  if (l.material && l.material.trim()) return l.material.trim()
  return MATERIAL_OBJ[(l.objetivo_material || '').trim()] || ''
}
function qtd(l: Linha): number {
  return typeof l.total === 'number' && l.total > 0 ? l.total : (l.tamanhos || []).reduce((a, t) => a + (t.qtd || 0), 0)
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  let bruto: unknown
  try { bruto = await req.json() } catch { return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 }) }
  const p = Body.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: 'Dados inválidos' }, { status: 400 })
  const { index, instrucoes, regenIaIndex } = p.data

  const { data: pedido } = await supabase
    .from('pedidos_assistente')
    .select('id, linhas, mockups, pagamento_status')
    .eq('id', id)
    .maybeSingle<{ id: string; linhas: Linha[] | null; mockups: Mapa | null; pagamento_status: string | null }>()
  if (!pedido) return NextResponse.json({ erro: 'Pedido não encontrado' }, { status: 404 })
  if (pedido.pagamento_status === 'pago') return NextResponse.json({ erro: 'Pedido já pago — não dá pra alterar' }, { status: 409 })

  const linhas = Array.isArray(pedido.linhas) ? pedido.linhas : []
  const l = linhas[index]
  if (!l) return NextResponse.json({ erro: 'Produto não encontrado' }, { status: 404 })

  // Gate: detalhes mínimos + ao menos 1 arte.
  const mapa: Mapa = pedido.mockups && typeof pedido.mockups === 'object' ? { ...pedido.mockups } : {}
  const mk: Mockup = { ...(mapa[String(index)] || {}) }
  const artesUrls = Array.isArray(mk.fotos) ? mk.fotos.filter((x) => typeof x === 'string' && x.length > 0) : []
  if (ehPlaceholder(l.modelo) || ehPlaceholder(corLimpa(l.cor)) || qtd(l) <= 0) {
    return NextResponse.json({ erro: 'Complete os detalhes do modelo (tipo da peça, cor e quantidade) antes de gerar o mockup com IA.' }, { status: 422 })
  }
  if (artesUrls.length === 0) {
    return NextResponse.json({ erro: 'Envie ao menos uma arte/foto neste produto antes de gerar o mockup.' }, { status: 422 })
  }

  const artes: ImagemEntrada[] = []
  for (const u of artesUrls) { const e = parseDataUrl(u); if (e) artes.push(e) }
  if (artes.length === 0) return NextResponse.json({ erro: 'Artes inválidas' }, { status: 400 })

  const estampado = l.estampado === true || (l.estampas?.length ?? 0) > 0
  const ctxProd = [
    l.modelo,
    corLimpa(l.cor) ? `na cor ${corLimpa(l.cor)}` : '',
    materialDaLinha(l) ? `em ${materialDaLinha(l)}` : '',
    estampado ? 'com estampa/bordado' : '',
  ].filter(Boolean).join(' ')

  const iaAtual: IAItem[] = Array.isArray(mk.ia) ? mk.ia.slice() : []
  const ajustando = typeof regenIaIndex === 'number' && iaAtual[regenIaIndex]
  const instr = instrucoes.trim()

  // A peça é LISA (sem nada aplicado) quando o modelo NÃO é estampado/bordado,
  // ou quando o cliente pede explicitamente "sem estampa/logo" / "lisa". Nesse
  // caso as imagens enviadas são REFERÊNCIA do tipo de peça — NÃO uma logo a
  // aplicar — e a IA não deve inventar logo/selo/estampa.
  const pedeLisa = /sem\s*(estampa|logo|logotipo|marca|arte|print|bordad|aplica|emblema|selo)|totalmente\s*lis|\blis[ao]s?\b/i.test(instr)
  const semAplicacao = !estampado || pedeLisa
  const SEM_APLICACAO_REGRA = 'A peça é LISA: NÃO adicione logo, estampa, bordado, emblema, selo/etiqueta redonda, marca nem texto. Não invente nenhum logotipo. Se houver algo aplicado, remova.'

  let imagens: ImagemEntrada[]
  let prompt: string
  if (ajustando) {
    const base = parseDataUrl(iaAtual[regenIaIndex].url)
    imagens = base ? [base, ...artes] : artes
    prompt = [
      'A PRIMEIRA imagem é um mockup já gerado deste produto.',
      semAplicacao
        ? 'As imagens seguintes são apenas REFERÊNCIA do tipo de peça (não são logo).'
        : 'As imagens seguintes são a logo/arte enviada pelo cliente.',
      `Ajuste o mockup conforme o pedido do cliente: ${instr || 'melhore o realismo mantendo o produto.'}`,
      `Produto: ${ctxProd}.`,
      corLimpa(l.cor) ? `Mantenha a peça na cor "${corLimpa(l.cor)}".` : '',
      semAplicacao ? SEM_APLICACAO_REGRA : '',
      'Mantenha um mockup realista de produto, fundo branco uniforme, boa iluminação. Devolva apenas a imagem final.',
    ].filter(Boolean).join(' ')
  } else if (semAplicacao) {
    imagens = artes
    prompt = [
      `Crie um mockup de produto realista: ${ctxProd}.`,
      corLimpa(l.cor) ? `IMPORTANTE: a peça (tecido) DEVE ser exatamente na cor "${corLimpa(l.cor)}".` : '',
      artes.length > 1
        ? 'As imagens fornecidas são apenas REFERÊNCIA do tipo/estilo da peça desejada.'
        : 'A imagem fornecida é apenas REFERÊNCIA do tipo/estilo da peça desejada.',
      SEM_APLICACAO_REGRA,
      instr ? `Observações do cliente: ${instr}.` : '',
      'Mostre o produto em vista frontal (e traseira, se as instruções mencionarem as costas), com a peça inteira e bem enquadrada.',
      'Fundo branco uniforme, iluminação de estúdio, sem texto extra. Devolva apenas a imagem final.',
    ].filter(Boolean).join(' ')
  } else {
    imagens = artes
    prompt = [
      `Crie um mockup de produto realista: ${ctxProd}.`,
      corLimpa(l.cor) ? `IMPORTANTE: a peça (tecido) DEVE ser exatamente na cor "${corLimpa(l.cor)}". A logo/arte mantém as cores originais dela.` : '',
      artes.length > 1 ? 'As imagens fornecidas são as logos/artes do cliente.' : 'A imagem fornecida é a logo/arte do cliente.',
      instr
        ? `Aplique conforme as instruções do cliente: ${instr}.`
        : 'Aplique a arte de forma centralizada e proporcional na área mais natural do produto (peito, em roupas), com bom senso.',
      'Mostre o produto em vista frontal (e traseira, se as instruções mencionarem as costas), com a peça inteira e bem enquadrada.',
      'Fundo branco uniforme, iluminação de estúdio, sem texto extra. Devolva apenas a imagem final.',
    ].filter(Boolean).join(' ')
  }

  const r = await gerarImagem({ prompt, imagens, aspectRatio: '1:1', imageSize: '2K' })
  if (!r.disponivel) return NextResponse.json({ disponivel: false, motivo: r.motivo })

  const url = await normalizarMockup(`data:${r.mime};base64,${r.imagemBase64}`)
  const novoItem: IAItem = { url, prompt: instr || undefined }
  let iaNova: IAItem[]
  if (ajustando) {
    iaNova = iaAtual.slice()
    iaNova[regenIaIndex] = novoItem
  } else {
    iaNova = [...iaAtual, novoItem].slice(-MAX_IA)
  }
  mk.ia = iaNova
  mapa[String(index)] = mk

  const { error } = await supabase
    .from('pedidos_assistente')
    .update({ mockups: mapa, atualizado_em: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ erro: 'Erro ao salvar o mockup gerado' }, { status: 500 })

  return NextResponse.json({ disponivel: true, ia: iaNova })
}
