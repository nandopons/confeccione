// app/lib/proposta-pedido.ts
// ============================================================================
// A PROPOSTA CONSOLIDADA — 29/09/2026 (decisão do Fernando).
//
// A Morenna (pedido 20260900350) escreveu "pode ser, veja como fica melhor, me
// ajude — minha primeira vez" e ouviu em seguida "agora as saias, quantas
// peças e em quais cores?", com roupa infantil e blazer ainda pela frente:
// vinte perguntas pra quem tinha acabado de dizer que não queria decidir campo
// por campo. E as contas que o modelo fez no meio saíram erradas ("6 P, 6 M,
// 5 G e 3 GG por cor" pra 4 peças por cor).
//
// "Nesses casos não dá pra gente perguntar se ela quer que a gente monte um
// pedido pra ela, e apresentar algo consolidado?" — Fernando.
//
// Então: o modelo pergunta se ela quer, junta o pouco que falta (quais peças,
// mais ou menos quantas) e passa BLOCOS pra cá — peça, público, total, cores,
// grade e pesos. A divisão por cor e por tamanho é conta de código (maior
// resto, soma sempre bate), a lista inteira vai pro pedido de uma vez e o
// texto que o cliente lê sai daqui, com os mesmos números que foram gravados.
// O modelo não escreve a proposta nem repete número.
//
// FOCO, NÃO MIX — a segunda decisão do mesmo dia. "Esses pedidos muito
// partidos... melhor induzir a cliente a escolher só determinados modelos,
// senão a confecção não vai querer produzir. Pelo menos uns 10 de cada cor.
// Fazer a cliente focar no que é mais comercial pra começar, depois ela
// adiciona." (Fernando, vendo 20 peças infantis divididas em calça cargo,
// polo, gola V e conjunto.) A proposta então CONCENTRA: com o total que ela
// deu, ficam só as cores que dão MINIMO_POR_LINHA peças cada; as outras
// entram na próxima leva, e o texto diz isso. Bloco que não chega ao mínimo
// nem com uma cor só é recusado — é o modelo quem volta pra ela e junta ou
// sobe. Se ela insistir depois de ouvir que a confecção pode não pegar,
// `aceitar_lotes_pequenos` deixa passar.
//
// UM PEDIDO POR PÚBLICO E POR ESTILO — a terceira. "Vale a pena fechar um
// pedido de feminino adulto e depois outro só de infantil. Por gênero é mais
// fácil de aceitarem; estilo de produto também. E explicar que o fornecedor
// às vezes é especializado em determinado produto e pode não querer pegar o
// pedido por conta de outros modelos que ele não faz." (Fernando.) A proposta
// fica com o GRUPO PRINCIPAL — o público e a família de peça com mais volume;
// o resto sai do pedido e o texto diz que vai num pedido separado, logo em
// seguida, e por quê. Quem abre o segundo é o modelo, depois que o primeiro
// for liberado (ver o prompt).
// ============================================================================

import type { PecaEntrada } from './pedido-fechamento'
import { descricaoSemGrade, pecaDaLinha } from './pecas'

/** Abaixo disto por linha (peça + cor) a confecção dificilmente pega — Fernando, 29/09/2026. */
export const MINIMO_POR_LINHA = 10

export type BlocoProposta = {
  modelo: string
  publico: 'feminino' | 'masculino' | 'infantil' | 'unissex'
  /** Total do bloco, somando todas as cores. */
  total: number
  /** Uma linha do pedido por cor ("estampa floral" conta como cor), da mais comercial pra menos. */
  cores: string[]
  /** Só quando ELE disse quanto de cada cor. Mesma ordem de `cores`; a soma vale como total. */
  quantidades_por_cor?: number[] | null
  /** Tamanhos: ["P","M","G","GG"], ["36","38","40"], ["2","4","6"]. Vazio = sem grade. */
  grade?: string[] | null
  /** Proporção entre os tamanhos, mesma ordem de `grade`. Vazio = por igual. */
  pesos_da_grade?: number[] | null
  material?: string | null
  descricao?: string | null
}

export type Proposta = {
  linhas: PecaEntrada[]
  texto: string
  total: number
  /** Cores que ficaram pra próxima leva, por bloco (o texto já conta isso ao cliente). */
  deixadasPraDepois: Array<{ modelo: string; cores: string[] }>
  /** Blocos inteiros que saíram deste pedido (outro público ou outra família de peça) — vão num pedido separado. */
  paraOutroPedido: BlocoProposta[]
  /** A família de produção do grupo principal, em português ("moda feminina (vestido, saia, calça)"), quando dá pra saber. */
  familia: string | null
}

/**
 * Famílias de produção: o que costuma sair da MESMA confecção. Peça ambígua
 * ("calça" pode ser alfaiataria, jeans ou jogger) carrega mais de uma; o grupo
 * fecha na interseção. Peça que o catálogo não reconhece entra em qualquer
 * grupo — "não sei" não separa pedido.
 */
const FAMILIAS: Record<string, string[]> = {
  camiseta: ['malha'],
  moletom_jaqueta: ['malha'],
  camisa_polo: ['malha', 'alfaiataria', 'uniforme'],
  blusa_top: ['malha', 'moda feminina', 'fitness'],
  uniforme: ['uniforme', 'malha', 'alfaiataria'],
  jaleco_avental: ['uniforme'],
  fitness: ['fitness'],
  uv: ['fitness', 'malha'],
  vestido: ['moda feminina'],
  saia: ['moda feminina'],
  macacao: ['moda feminina'],
  calca: ['moda feminina', 'alfaiataria', 'malha', 'uniforme'],
  bermuda_short: ['malha', 'moda feminina', 'fitness'],
  blazer: ['alfaiataria'],
  colete: ['alfaiataria', 'uniforme'],
  infantil: ['infantil'],
  moda_praia: ['moda praia'],
  moda_intima: ['moda íntima'],
  pet: ['pet'],
  bone: ['acessórios'],
  bolsa: ['acessórios'],
  meia: ['acessórios'],
  cama_mesa_banho: ['acessórios'],
  acessorios: ['acessórios'],
}

const NOME_DA_FAMILIA: Record<string, string> = {
  malha: 'malha (camiseta, moletom, polo)',
  alfaiataria: 'alfaiataria',
  uniforme: 'uniforme',
  fitness: 'fitness',
  'moda feminina': 'moda feminina (vestido, saia, calça)',
  infantil: 'infantil',
  'moda praia': 'moda praia',
  'moda íntima': 'moda íntima',
  pet: 'roupa pet',
  acessórios: 'acessórios',
}

function familiasDoBloco(b: BlocoProposta): string[] | null {
  const peca = pecaDaLinha(b.modelo)
  return peca ? (FAMILIAS[peca] ?? null) : null
}

/**
 * O grupo principal e o que sai. O maior bloco ancora (público e famílias);
 * cada bloco seguinte entra se for do mesmo público e tiver família em comum
 * com o grupo (a interseção aperta a cada entrada). Infantil não separa por
 * família: confecção infantil faz o mix.
 */
export function separarGrupoPrincipal(blocos: BlocoProposta[]): { principal: BlocoProposta[]; resto: BlocoProposta[]; familia: string | null } {
  if (blocos.length <= 1) return { principal: blocos, resto: [], familia: null }
  const ordem = blocos
    .map((b, i) => ({ b, i, total: b.quantidades_por_cor ? b.quantidades_por_cor.reduce((s, q) => s + q, 0) : b.total }))
    .sort((a, c) => c.total - a.total || a.i - c.i)
  const ancora = ordem[0].b
  const publico = ancora.publico
  let familias: string[] | null = publico === 'infantil' ? null : familiasDoBloco(ancora)
  const dentro = new Set<number>([ordem[0].i])
  for (const { b, i } of ordem.slice(1)) {
    if (b.publico !== publico) continue
    if (publico === 'infantil') {
      dentro.add(i)
      continue
    }
    const suas = familiasDoBloco(b)
    if (!suas || !familias) {
      dentro.add(i)
      if (!familias && suas) familias = suas
      continue
    }
    const comum = familias.filter((f) => suas.includes(f))
    if (comum.length === 0) continue
    familias = comum
    dentro.add(i)
  }
  return {
    principal: blocos.filter((_, i) => dentro.has(i)),
    resto: blocos.filter((_, i) => !dentro.has(i)),
    familia: familias && familias.length > 0 ? familias[0] : null,
  }
}

/**
 * Reparte `total` em partes proporcionais a `pesos`, com a soma exata (método
 * do maior resto). Pesos inválidos ou todos zero = por igual. Empate no resto
 * vai pra parte que vem antes — a primeira cor citada, o primeiro tamanho.
 */
export function repartir(total: number, pesos: number[]): number[] {
  const n = pesos.length
  if (n === 0) return []
  const t = Math.max(0, Math.floor(total))
  const validos = pesos.map((p) => (Number.isFinite(p) && p > 0 ? p : 0))
  const soma = validos.reduce((s, p) => s + p, 0)
  const w = soma > 0 ? validos : pesos.map(() => 1)
  const somaW = w.reduce((s, p) => s + p, 0)
  const exatas = w.map((p) => (t * p) / somaW)
  const base = exatas.map((x) => Math.floor(x))
  let resto = t - base.reduce((s, x) => s + x, 0)
  const ordem = exatas
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const { i } of ordem) {
    if (resto <= 0) break
    base[i] += 1
    resto -= 1
  }
  return base
}

function limpar(s: unknown, max: number): string {
  return typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

/** Valida e normaliza o que o modelo passou. Lança com a explicação que o modelo precisa pra corrigir. */
export function lerBlocos(entrada: unknown): BlocoProposta[] {
  if (!Array.isArray(entrada) || entrada.length === 0) throw new Error('passe ao menos um bloco (uma peça do pedido)')
  if (entrada.length > 12) throw new Error('no máximo 12 blocos por proposta')
  const publicos = new Set(['feminino', 'masculino', 'infantil', 'unissex'])
  return entrada.map((raw, idx) => {
    const b = (raw ?? {}) as Record<string, unknown>
    const rotulo = `bloco ${idx + 1}`
    const modelo = limpar(b.modelo, 120)
    if (!modelo) throw new Error(`${rotulo}: falta o modelo (a peça)`)
    const publico = limpar(b.publico, 20).toLowerCase()
    if (!publicos.has(publico)) throw new Error(`${rotulo} (${modelo}): público tem que ser feminino, masculino, infantil ou unissex`)
    const cores = (Array.isArray(b.cores) ? b.cores : []).map((c) => limpar(c, 80)).filter(Boolean)
    if (cores.length === 0) throw new Error(`${rotulo} (${modelo}): passe ao menos uma cor (ou "estampa floral", "a definir")`)
    if (cores.length > 12) throw new Error(`${rotulo} (${modelo}): no máximo 12 cores`)
    const porCor = Array.isArray(b.quantidades_por_cor) ? (b.quantidades_por_cor as unknown[]).map((q) => (typeof q === 'number' && Number.isFinite(q) ? Math.floor(q) : NaN)) : []
    let total = typeof b.total === 'number' && Number.isFinite(b.total) ? Math.floor(b.total) : 0
    if (porCor.length > 0) {
      if (porCor.length !== cores.length || porCor.some((q) => !Number.isFinite(q) || q < 1)) {
        throw new Error(`${rotulo} (${modelo}): quantidades_por_cor precisa ter um número (≥ 1) pra cada cor, na mesma ordem`)
      }
      total = porCor.reduce((s, q) => s + q, 0)
    }
    if (total < 1) throw new Error(`${rotulo} (${modelo}): falta o total de peças`)
    const grade = (Array.isArray(b.grade) ? b.grade : []).map((t) => limpar(t, 12)).filter(Boolean)
    if (grade.length > 30) throw new Error(`${rotulo} (${modelo}): grade com mais de 30 tamanhos`)
    const pesos = Array.isArray(b.pesos_da_grade) ? (b.pesos_da_grade as unknown[]).map((p) => (typeof p === 'number' && Number.isFinite(p) && p >= 0 ? p : 0)) : []
    if (pesos.length > 0 && pesos.length !== grade.length) throw new Error(`${rotulo} (${modelo}): pesos_da_grade precisa ter um número pra cada tamanho da grade, na mesma ordem`)
    return {
      modelo,
      publico: publico as BlocoProposta['publico'],
      total,
      cores,
      quantidades_por_cor: porCor.length > 0 ? porCor : null,
      grade: grade.length > 0 ? grade : null,
      pesos_da_grade: pesos.length > 0 ? pesos : null,
      material: limpar(b.material, 200) || null,
      descricao: descricaoSemGrade(limpar(b.descricao, 400)) || null,
    }
  })
}

function primeiraMaiuscula(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function listar(itens: string[]): string {
  if (itens.length <= 1) return itens.join('')
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`
}

/**
 * As linhas do pedido (uma por cor) e o texto que vai pro cliente. Os números
 * do texto são os das linhas — é a mesma conta.
 *
 * Lança quando um bloco não chega ao mínimo nem com uma cor só (ou quando ele
 * fixou quantidades abaixo do mínimo) e `aceitarLotesPequenos` não está
 * ligado: a mensagem é pro modelo voltar ao cliente e concentrar.
 */
export function montarProposta(todos: BlocoProposta[], opts: { aceitarLotesPequenos?: boolean } = {}): Proposta {
  const aceitar = Boolean(opts.aceitarLotesPequenos)
  const linhas: PecaEntrada[] = []
  const partes: string[] = []
  const deixadasPraDepois: Proposta['deixadasPraDepois'] = []
  let total = 0

  const { principal: blocos, resto: paraOutroPedido, familia } = separarGrupoPrincipal(todos)

  for (const b of blocos) {
    let cores = b.cores
    let porCor: number[]
    if (b.quantidades_por_cor) {
      porCor = b.quantidades_por_cor
      const pequenas = cores.filter((_, i) => porCor[i] < MINIMO_POR_LINHA)
      if (pequenas.length > 0 && !aceitar) {
        throw new Error(
          `${b.modelo}: ${listar(pequenas)} com menos de ${MINIMO_POR_LINHA} peças por cor — abaixo disso a confecção dificilmente pega. ` +
            'Diga isso ao cliente em uma linha e proponha concentrar (menos cores, ou mais peças nas que ficam). ' +
            'Só se ele insistir depois de ouvir isso, chame de novo com aceitar_lotes_pequenos: true.'
        )
      }
    } else {
      if (b.total < MINIMO_POR_LINHA && !aceitar) {
        throw new Error(
          `${b.modelo}: ${b.total} peça(s) no total é menos que o mínimo de ${MINIMO_POR_LINHA} por peça e cor — a confecção dificilmente pega. ` +
            'Junte com outro modelo, tire este da primeira leva ou suba o total; diga ao cliente o porquê em uma linha. ' +
            'Só se ele insistir, chame de novo com aceitar_lotes_pequenos: true.'
        )
      }
      // FOCO: só as cores que dão o mínimo cada; as outras ficam pra depois.
      const cabem = aceitar ? cores.length : Math.max(1, Math.min(cores.length, Math.floor(b.total / MINIMO_POR_LINHA)))
      if (cabem < cores.length) {
        deixadasPraDepois.push({ modelo: b.modelo, cores: cores.slice(cabem) })
        cores = cores.slice(0, cabem)
      }
      porCor = repartir(b.total, cores.map(() => 1))
    }

    const cabecalho = [`*${primeiraMaiuscula(b.modelo)}*`, [b.publico, b.material].filter(Boolean).join(', ')].filter(Boolean).join(' — ')
    const bloco: string[] = [cabecalho]
    if (b.descricao) bloco.push(b.descricao)
    cores.forEach((cor, i) => {
      const qtd = porCor[i] ?? 0
      if (qtd <= 0) return
      const tamanhos = b.grade
        ? repartir(qtd, b.pesos_da_grade ?? b.grade.map(() => 1))
            .map((q, j) => ({ tamanho: b.grade![j], qtd: q }))
            .filter((t) => t.qtd > 0)
        : null
      linhas.push({
        modelo: b.modelo,
        cor,
        material: b.material ?? null,
        quantidade: qtd,
        publico: b.publico,
        descricao: b.descricao ?? null,
        tamanhos,
      })
      total += qtd
      const grade = tamanhos && tamanhos.length > 0 ? ` (${tamanhos.map((t) => `${t.tamanho} ${t.qtd}`).join(', ')})` : ''
      bloco.push(`- ${cor}: ${qtd}${grade}`)
    })
    partes.push(bloco.join('\n'))
  }

  if (linhas.length === 0) throw new Error('a proposta ficou sem nenhuma linha — confira totais e cores')

  const foco =
    deixadasPraDepois.length > 0
      ? '\n\n' +
        deixadasPraDepois
          .map((d) => {
            const ficaram = blocos.find((b) => b.modelo === d.modelo)?.cores.filter((c) => !d.cores.includes(c)) ?? []
            return `Pra começar, ${d.modelo}: só ${listar(ficaram)} agora; ${listar(d.cores)} ${d.cores.length === 1 ? 'fica' : 'ficam'} pra próxima leva`
          })
          .join('\n') +
        `\nAbaixo de ${MINIMO_POR_LINHA} peças por cor a confecção dificilmente pega, então concentrei no que dá volume — depois da primeira leva dá pra somar cores e modelos`
      : ''

  const separado =
    paraOutroPedido.length > 0
      ? '\n\n' +
        `O que ficou de fora vai num pedido separado, logo depois deste: ${listar(
          paraOutroPedido.map((b) => `${b.modelo} (${b.publico}, ${b.quantidades_por_cor ? b.quantidades_por_cor.reduce((s, q) => s + q, 0) : b.total} peças)`)
        )}\n` +
        'A confecção costuma ser especializada — quem faz uma linha muitas vezes não faz a outra — e um pedido com tudo junto acaba sem ninguém querer pegar inteiro. Separando, cada um chega em quem faz'
      : ''

  const texto =
    'Montei uma proposta com o que a gente conversou:\n\n' +
    partes.join('\n\n') +
    `\n\nTotal: ${total} peça${total === 1 ? '' : 's'}` +
    foco +
    separado +
    '\n\nSe quiser mudar alguma coisa (quantidade, cor, grade), me diz o que muda que eu ajusto\n' +
    'Se estiver tudo certo, me confirma que eu sigo'
  return { linhas, texto, total, deixadasPraDepois, paraOutroPedido, familia: familia ? (NOME_DA_FAMILIA[familia] ?? familia) : null }
}
