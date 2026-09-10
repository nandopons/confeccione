// app/lib/mockup-pedido.ts
// ============================================================================
// GERAÇÃO DE MOCKUP DE IA — um caminho só, usado pela tela e pelo Luigi.
//
// POR QUE VIROU LIB — 10/09/2026
// A lógica vivia dentro da rota do visualizador. Quando o Luigi passou a poder
// gerar mockup também, a saída fácil seria copiar o prompt pro lado dele — e aí
// existiriam dois prompts que começam iguais e divergem no primeiro ajuste que
// alguém fizer num só. Prompt duplicado é a mesma classe de bug que "o dado
// existe no banco e não chega": ninguém percebe até o resultado sair torto.
//
// O BUG QUE ISTO CORRIGE — o mais caro do arquivo
// A rota lia as fotos do cliente com um `parseDataUrl` que só entende
// `data:image/...;base64,`. Desde 31/08 as imagens do pedido não são mais data
// URI: são referências curtas `storage:pedidos/<id>/<sha>.<ext>` (ver
// imagens-pedido-storage.ts). O regex não casava, a função devolvia null, e a
// lista de artes chegava VAZIA na IA — em silêncio, sem erro em log nenhum.
//
// O efeito era pior que "não usou a foto". Com a lista vazia, a peça estampada
// caía no galho `aproximarPelaDescricao`, que manda a IA INVENTAR a estampa a
// partir do texto. O cliente subia a logo dele e recebia de volta um mockup com
// uma logo fantasia. Aconteceu em 6 peças desde 31/08 — inclusive no pedido de
// hoje — e mais 5 perderam a foto de referência do tipo de peça. Todas as que
// tinham foto: a taxa de acerto era zero.
//
// O certo já existia no mesmo módulo que a rota importava: `lerImagem` entende
// os dois formatos e é o ponto único onde eles convivem. A rota importou
// `refParaUrl` desse arquivo e não importou essa.
//
// LIÇÃO PRA PRÓXIMA MIGRAÇÃO DE FORMATO: quem lê tem que passar pelo leitor
// oficial. Parser local de formato é onde a migração vaza.
// ============================================================================

import { gerarImagem, type ImagemEntrada } from './mockup-image'
import { normalizarMockup } from './imagem-normalizar'
import { guardarImagem, lerImagem, refParaUrl } from './imagens-pedido-storage'
import { supabaseAdmin } from './supabase-server'

/** Quantos mockups de IA um modelo guarda. Passou disso, o mais antigo sai. */
export const MAX_IA = 4

/**
 * Teto de imagens de referência enviadas ao provedor.
 *
 * Não é economia: é foco. Com seis fotos a IA começa a misturar elementos de
 * todas e o mockup deixa de parecer o pedido. As primeiras são as que o cliente
 * mandou primeiro, que na prática são as que ele considera principais.
 */
const MAX_REFS = 3

export type IAItem = { url: string; prompt?: string }
export type Mockup = { liso?: string; arte?: string; fotos?: string[]; ia?: IAItem[] }
export type MapaMockups = Record<string, Mockup>

export type LinhaMockup = {
  modelo?: string | null
  cor?: string | null
  material?: string | null
  total?: number | null
  tamanhos?: { tamanho?: string | null; qtd?: number | null }[] | null
  estampas?: { posicao?: string | null; tamanho?: string | null }[] | null
  estampado?: boolean | null
  objetivo_material?: string | null
  descricao?: string | null
}

export type ResultadoMockupPedido =
  | { ok: true; ia: IAItem[]; referenciasUsadas: number; modelo: string }
  | { ok: false; tipo: 'erro'; erro: string; status: number }
  | { ok: false; tipo: 'indisponivel'; motivo: string }

// ----------------------------------------------------------------------------
// Leitura dos dados do modelo
// ----------------------------------------------------------------------------

export function corLimpa(s?: string | null): string {
  return (s || '')
    .replace(/\s*\(#?[0-9a-fA-F]{6}\)\s*/g, ' ')
    .replace(/#[0-9a-fA-F]{6}/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * "A definir" não é um dado — é a ausência dele com cara de preenchido.
 * Sem esta checagem a IA geraria um mockup de uma peça "a combinar".
 */
export function ehPlaceholder(v?: string | null): boolean {
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

export function materialDaLinha(l: LinhaMockup): string {
  if (l.material && l.material.trim()) return l.material.trim()
  return MATERIAL_OBJ[(l.objetivo_material || '').trim()] || ''
}

export function qtdDaLinha(l: LinhaMockup): number {
  return typeof l.total === 'number' && l.total > 0
    ? l.total
    : (l.tamanhos || []).reduce((a, t) => a + (t.qtd || 0), 0)
}

export function ehEstampado(l: LinhaMockup): boolean {
  return l.estampado === true || (l.estampas?.length ?? 0) > 0
}

/** As fotos que o cliente anexou a este modelo, já filtradas. */
export function fotosDoModelo(mk: Mockup | undefined): string[] {
  return Array.isArray(mk?.fotos) ? mk.fotos.filter((x) => typeof x === 'string' && x.length > 0) : []
}

/**
 * O que falta pro modelo poder virar mockup. Lista vazia = pode gerar.
 *
 * Existe separado da geração porque o Luigi precisa SABER antes de tentar: ele
 * decide se gera, e uma ferramenta que só devolve erro depois de rodar não
 * ajuda a decidir.
 */
export function faltaParaMockup(l: LinhaMockup, mk?: Mockup, instrucoes = ''): string[] {
  const falta: string[] = []
  if (ehPlaceholder(l.modelo)) falta.push('tipo da peça')
  if (ehPlaceholder(corLimpa(l.cor))) falta.push('cor')
  if (qtdDaLinha(l) <= 0) falta.push('quantidade')
  if (ehEstampado(l)) {
    const temRef = fotosDoModelo(mk).length > 0 || !ehPlaceholder(l.descricao) || instrucoes.trim().length > 0
    if (!temRef) falta.push('a arte ou uma descrição da estampa/bordado')
  }
  return falta
}

// ----------------------------------------------------------------------------
// Carregamento das imagens
// ----------------------------------------------------------------------------

/**
 * Converte as referências do banco em bytes pro provedor.
 *
 * Passa por `lerImagem`, que resolve tanto o data URI legado quanto a
 * referência de bucket. Uma imagem que não abre é descartada e o resto segue:
 * perder uma foto é ruim, não gerar nada porque uma falhou é pior.
 */
async function carregarImagens(refs: string[]): Promise<ImagemEntrada[]> {
  const lidas = await Promise.all(
    refs.slice(0, MAX_REFS).map(async (ref) => {
      try {
        const img = await lerImagem(ref)
        return img ? { base64: img.bytes.toString('base64'), mime: img.mime } : null
      } catch (err) {
        console.error('[mockup-pedido] falhou ao ler imagem de referência:', ref, err)
        return null
      }
    })
  )
  return lidas.filter((x): x is ImagemEntrada => x !== null)
}

// ----------------------------------------------------------------------------
// Prompt
// ----------------------------------------------------------------------------

const SEM_APLICACAO_REGRA =
  'A peça é LISA: NÃO adicione logo, estampa, bordado, emblema, selo/etiqueta redonda, marca nem texto. Não invente nenhum logotipo. Se houver algo aplicado, remova.'

const FECHAMENTO = 'Fundo branco uniforme, iluminação de estúdio, sem texto extra. Devolva apenas a imagem final.'
const ENQUADRAMENTO =
  'Mostre o produto em vista frontal (e traseira, se as instruções mencionarem as costas), com a peça inteira e bem enquadrada.'

type EntradaPrompt = {
  linha: LinhaMockup
  artes: ImagemEntrada[]
  instrucoes: string
  baseAjuste: ImagemEntrada | null
}

/**
 * Monta o prompt e a lista de imagens. Quatro situações, e a diferença entre
 * elas é o que a IA pode inventar:
 *
 *   ajuste       — já existe mockup; a IA MEXE nele em vez de recomeçar
 *   sem aplicação— peça lisa: as fotos são referência de TIPO, não logo
 *   aproximação  — estampada sem arquivo: a IA cria a estampa pelo texto
 *   com arte     — estampada com o arquivo: a IA APLICA a arte que recebeu
 *
 * O galho "aproximação" é o único onde a IA desenha marca — e agora ele só é
 * alcançado quando realmente não há arquivo, e não quando o leitor falhou.
 */
export function montarPromptMockup(e: EntradaPrompt): { prompt: string; imagens: ImagemEntrada[] } {
  const { linha: l, artes, instrucoes: instr, baseAjuste } = e
  const cor = corLimpa(l.cor)
  const material = materialDaLinha(l)
  const estampado = ehEstampado(l)
  const descricao = l.descricao && l.descricao.trim() ? l.descricao.trim() : ''

  const ctxProd = [
    l.modelo,
    cor ? `na cor ${cor}` : '',
    material ? `em ${material}` : '',
    estampado ? 'com estampa/bordado' : '',
  ]
    .filter(Boolean)
    .join(' ')

  // Cliente pedindo peça lisa explicitamente vence a marcação de estampada:
  // quem sabe o que quer é ele, e o cadastro pode estar velho.
  const pedeLisa =
    /sem\s*(estampa|logo|logotipo|marca|arte|print|bordad|aplica|emblema|selo)|totalmente\s*lis|\blis[ao]s?\b/i.test(instr)
  const semAplicacao = !estampado || pedeLisa
  // O `!pedeLisa` importa no galho de AJUSTE: sem ele, o cliente que pede "tira
  // a estampa" recebia no mesmo prompt a descrição da estampa a representar, e a
  // IA obedecia às duas coisas — apagava e desenhava de novo.
  const aproximarPelaDescricao = estampado && !pedeLisa && artes.length === 0

  if (baseAjuste) {
    return {
      imagens: [baseAjuste, ...artes],
      prompt: [
        'A PRIMEIRA imagem é um mockup já gerado deste produto.',
        semAplicacao
          ? 'As imagens seguintes são apenas REFERÊNCIA do tipo de peça (não são logo).'
          : artes.length > 0
            ? 'As imagens seguintes são a logo/arte enviada pelo cliente.'
            : 'Não há arquivo de arte: a estampa/bordado deve ser criada a partir da descrição.',
        `Ajuste o mockup conforme o pedido do cliente: ${instr || 'melhore o realismo mantendo o produto.'}`,
        `Produto: ${ctxProd}.`,
        cor ? `Mantenha a peça na cor "${cor}".` : '',
        semAplicacao ? SEM_APLICACAO_REGRA : '',
        aproximarPelaDescricao && descricao ? `Estampa/bordado a representar (aproximação): ${descricao}.` : '',
        'Mantenha um mockup realista de produto, fundo branco uniforme, boa iluminação. Devolva apenas a imagem final.',
      ]
        .filter(Boolean)
        .join(' '),
    }
  }

  if (semAplicacao) {
    const refLinha =
      artes.length === 0
        ? 'Não há imagem de referência: gere a peça a partir da descrição abaixo.'
        : artes.length > 1
          ? 'As imagens fornecidas são apenas REFERÊNCIA do tipo/estilo da peça desejada.'
          : 'A imagem fornecida é apenas REFERÊNCIA do tipo/estilo da peça desejada.'
    return {
      imagens: artes,
      prompt: [
        `Crie um mockup de produto realista: ${ctxProd}.`,
        cor ? `IMPORTANTE: a peça (tecido) DEVE ser exatamente na cor "${cor}".` : '',
        material ? `Tecido: ${material}.` : '',
        descricao ? `Detalhes do produto: ${descricao}.` : '',
        refLinha,
        SEM_APLICACAO_REGRA,
        instr ? `Observações do cliente: ${instr}.` : '',
        ENQUADRAMENTO,
        FECHAMENTO,
      ]
        .filter(Boolean)
        .join(' '),
    }
  }

  if (aproximarPelaDescricao) {
    return {
      imagens: [],
      prompt: [
        `Crie um mockup de produto realista: ${ctxProd}.`,
        cor ? `IMPORTANTE: a peça (tecido) DEVE ser exatamente na cor "${cor}".` : '',
        material ? `Tecido: ${material}.` : '',
        'Não há arquivo de arte enviado — gere uma APROXIMAÇÃO da estampa/bordado a partir da descrição do cliente.',
        descricao ? `Descrição da estampa/bordado: ${descricao}.` : '',
        instr ? `Instruções de aplicação: ${instr}.` : '',
        'Aplique a estampa/bordado de forma proporcional e bem posicionada na peça, com bom senso.',
        ENQUADRAMENTO,
        FECHAMENTO,
      ]
        .filter(Boolean)
        .join(' '),
    }
  }

  return {
    imagens: artes,
    prompt: [
      `Crie um mockup de produto realista: ${ctxProd}.`,
      cor
        ? `IMPORTANTE: a peça (tecido) DEVE ser exatamente na cor "${cor}". A logo/arte mantém as cores originais dela.`
        : '',
      artes.length > 1
        ? 'As imagens fornecidas são as logos/artes do cliente.'
        : 'A imagem fornecida é a logo/arte do cliente.',
      instr
        ? `Aplique conforme as instruções do cliente: ${instr}.`
        : 'Aplique a arte de forma centralizada e proporcional na área mais natural do produto (peito, em roupas), com bom senso.',
      ENQUADRAMENTO,
      FECHAMENTO,
    ]
      .filter(Boolean)
      .join(' '),
  }
}

// ----------------------------------------------------------------------------
// Geração
// ----------------------------------------------------------------------------

/**
 * Gera (ou ajusta) o mockup de IA de um modelo do pedido e grava em
 * `mockups[index].ia[]`. Aditivo: não encosta nas fotos do cliente.
 *
 * `regenIaIndex` aponta um mockup já gerado pra ser AJUSTADO em vez de somar
 * mais um na lista.
 */
export async function gerarMockupDoModelo(params: {
  pedidoId: string
  index: number
  instrucoes?: string
  regenIaIndex?: number | null
}): Promise<ResultadoMockupPedido> {
  const { pedidoId, index } = params
  const instrucoes = (params.instrucoes || '').trim()
  const regenIaIndex = typeof params.regenIaIndex === 'number' ? params.regenIaIndex : null

  const { data: pedido } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, linhas, mockups, pagamento_status')
    .eq('id', pedidoId)
    .maybeSingle<{
      id: string
      linhas: LinhaMockup[] | null
      mockups: MapaMockups | null
      pagamento_status: string | null
    }>()

  if (!pedido) return { ok: false, tipo: 'erro', erro: 'Pedido não encontrado', status: 404 }
  if (pedido.pagamento_status === 'pago') {
    return { ok: false, tipo: 'erro', erro: 'Pedido já pago — não dá pra alterar', status: 409 }
  }

  const linhas = Array.isArray(pedido.linhas) ? pedido.linhas : []
  const l = linhas[index]
  if (!l) return { ok: false, tipo: 'erro', erro: 'Produto não encontrado', status: 404 }

  const mapa: MapaMockups = pedido.mockups && typeof pedido.mockups === 'object' ? { ...pedido.mockups } : {}
  const mk: Mockup = { ...(mapa[String(index)] || {}) }

  const falta = faltaParaMockup(l, mk, instrucoes)
  if (falta.length > 0) {
    const detalhe = falta.join(', ')
    return {
      ok: false,
      tipo: 'erro',
      erro: ehEstampado(l) && falta.some((f) => f.startsWith('a arte'))
        ? `Pra gerar a estampa/bordado falta ${detalhe} — envie a arte ou descreva a estampa.`
        : `Complete os detalhes do modelo antes de gerar o mockup com IA: falta ${detalhe}.`,
      status: 422,
    }
  }

  const artes = await carregarImagens(fotosDoModelo(mk))

  const iaAtual: IAItem[] = Array.isArray(mk.ia) ? mk.ia.slice() : []
  const alvoAjuste = regenIaIndex !== null ? iaAtual[regenIaIndex] : undefined
  const baseAjuste = alvoAjuste ? (await carregarImagens([alvoAjuste.url]))[0] ?? null : null

  const { prompt, imagens } = montarPromptMockup({ linha: l, artes, instrucoes, baseAjuste })

  const r = await gerarImagem({ prompt, imagens, aspectRatio: '1:1', imageSize: '2K' })
  if (!r.disponivel) return { ok: false, tipo: 'indisponivel', motivo: r.motivo }

  // Vai pro bucket: o mockup de IA era o maior peso no TOAST do pedido.
  const url = await guardarImagem(await normalizarMockup(`data:${r.mime};base64,${r.imagemBase64}`), pedidoId)
  const novoItem: IAItem = { url, prompt: instrucoes || undefined }

  let iaNova: IAItem[]
  if (alvoAjuste && regenIaIndex !== null) {
    iaNova = iaAtual.slice()
    iaNova[regenIaIndex] = novoItem
  } else {
    iaNova = [...iaAtual, novoItem].slice(-MAX_IA)
  }
  mk.ia = iaNova
  mapa[String(index)] = mk

  const { error } = await supabaseAdmin
    .from('pedidos_assistente')
    .update({ mockups: mapa, atualizado_em: new Date().toISOString() })
    .eq('id', pedidoId)
  if (error) {
    console.error('[mockup-pedido] erro ao salvar:', error.message)
    return { ok: false, tipo: 'erro', erro: 'Erro ao salvar o mockup gerado', status: 500 }
  }

  return {
    ok: true,
    ia: iaNova,
    referenciasUsadas: artes.length,
    modelo: (l.modelo || '').trim() || `modelo ${index + 1}`,
  }
}

/** Traduz a lista de IA pra exibição no navegador (o `storage:` não abre em <img>). */
export function iaParaExibicao(ia: IAItem[], pedidoId: string): IAItem[] {
  return ia.map((it) => ({ ...it, url: refParaUrl(it.url, pedidoId) }))
}
