// app/lib/match-fornecedor.ts
// ============================================================================
// A REGRA PURA DE MATCH ENTRE PEDIDO E CONFECÇÃO — 12/09/2026.
//
// Mora num arquivo só dela, sem NENHUM import de servidor, por um motivo
// concreto: `pedido-assistente-oferta.ts` cria `supabaseAdmin` no topo do
// módulo, e a tela `/admin/pedidos-pagos` é client component. Importar a
// pontuação de lá levaria o client do service-role junto — é a mesma razão pela
// qual `pecasDoPedido` foi parar em `pecas.ts`.
//
// Quem importava de `pedido-assistente-oferta` continua importando: lá virou
// reexport.
// ============================================================================

import { legadoDasPecas, pecasDoPedido } from './pecas'

/** O que a tela precisa saber de um fornecedor pra pontuar. */
export type FornecedorParaMatch = {
  cidade: string | null
  estado: string | null
  status: string | null
  tipos_produto: string[] | null
  pecas: string[] | null
  pedido_minimo: number | null
  prazo_minimo_dias: number | null
}

export type MatchFornecedor = {
  pontos: number
  /** Por que ele apareceu no topo — vai pra tela, pra escolha não ser cega. */
  motivos: string[]
  /**
   * Se `false`, a fila automática NÃO oferta. A tela manual continua mostrando
   * (o Fernando pode saber de algo que o banco não sabe) — a diferença é que
   * ninguém manda no automático o que já se sabe que vai ser recusado.
   */
  viavel: boolean
}


export const MARGEM_PEDIDO_MINIMO = 0.2

/** A confecção DECLAROU esta peça no vocabulário novo (`leads_fornecedores.pecas`). */
export const PESO_PECA_DECLARADA = 20
/** Casou a categoria legada mais específica da peça (ou a do próprio pedido). */
export const PESO_CATEGORIA_PRINCIPAL = 20
/** Casou uma categoria legada secundária — evidência de encosto, não de ofício. */
export const PESO_CATEGORIA_SECUNDARIA = 10

/** Os dois motivos de peça. A tela pinta cada um de um jeito — ver o comentário
 *  no bloco de peça, em `pontuarFornecedor`. */
export const MOTIVO_PECA_DECLARADA = 'faz esse tipo de peça'
export const MOTIVO_PECA_LEGADA = 'pode fazer'

function normalizar(t: string | null | undefined): string {
  return (t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
}

/**
 * Quanto essa confecção casa com esse pedido. Maior é melhor; zero é "não vi
 * nada em comum", não é "ruim" — confecção sem cidade preenchida cai aqui.
 */
export function pontuarFornecedor(
  pedido: {
    cidade?: string | null
    uf?: string | null
    categoria?: string | null
    peca?: string | null
    pecas?: string[] | null
    /** Obrigatório — é de onde a peça sai. Ver `pecasDoPedido` em pecas.ts. */
    linhas: { modelo?: string | null }[] | null
    prazoDias?: number | null
  },
  f: FornecedorParaMatch,
  totalPecas?: number | null
): MatchFornecedor {
  const motivos: string[] = []
  let pontos = 0
  let viavel = true

  const cidadePedido = normalizar(pedido.cidade)
  const cidadeForn = normalizar(f.cidade)
  const ufPedido = normalizar(pedido.uf)
  const ufForn = normalizar(f.estado)

  if (cidadePedido && cidadeForn && cidadePedido === cidadeForn) {
    pontos += 50
    motivos.push('mesma cidade')
  } else if (ufPedido && ufForn && ufPedido === ufForn) {
    pontos += 30
    motivos.push('mesmo estado')
  }

  // ==========================================================================
  // PEÇA: O QUE O PEDIDO PEDE CONTRA O QUE A CONFECÇÃO FAZ — 12/09/2026.
  //
  // Isto era `[pedido.categoria, ...(pedido.pecas ?? [])]` comparado por
  // substring contra `tipos_produto`. Dois defeitos somados:
  //
  //  1. `pedido.pecas` é DECLARAÇÃO DE CRIAÇÃO, escrita uma vez pelos cards do
  //     site e nunca recalculada — 31 de 229 pedidos, zero nos do Luigi e da
  //     vitrine. O cliente que declarou camiseta e depois trocou as linhas por
  //     moletom continuava pontuando confecção de camiseta. Agora a peça vem das
  //     LINHAS (`pecasDoPedido`), com o declarado só como piso.
  //
  //  2. VOCABULÁRIOS DIFERENTES. `pedido.pecas` guarda id de catálogo
  //     ('moletom_jaqueta') e `tipos_produto` guarda categoria legada
  //     ('private_label', 'interclasse'). Substring entre os dois NUNCA casa —
  //     conferido: nenhum id do catálogo é substring de nenhuma categoria. Na
  //     prática só `pedido.categoria` pontuava, e a metade `pecas` era código
  //     morto que parecia funcionar. A tradução é `legadoDasPecas`, a mesma
  //     ponte que `coberturaDoPedido` usa.
  //
  // Duas vias porque as duas pontas estão em migração: 15 dos 41 fornecedores
  // aprovados já declaram `pecas`; os outros 26 só têm `tipos_produto`.
  // ==========================================================================
  const pedidas = pecasDoPedido(pedido)
  const fazPecasNovo = (f.pecas ?? []).filter(Boolean)
  const bateNoVocabularioNovo =
    pedidas.length > 0 && fazPecasNovo.length > 0 && pedidas.some((q) => fazPecasNovo.includes(q))

  // ==========================================================================
  // DUAS EVIDÊNCIAS, DOIS PESOS — 12/09/2026.
  //
  // O primeiro pedido real a passar por aqui (20260900293, scrub) expôs um
  // achatamento: VINTE E OITO fornecedores receberam o mesmo "faz esse tipo de
  // peça", e só DOIS batiam pelo vocabulário novo. Os outros 26 entraram pela
  // ponte legada — e 15 deles só por `interclasse`, que é "faz camiseta de
  // turma". Pra um scrub hospitalar isso é evidência fraca, e ficava com o
  // mesmo selo de quem declarou fardamento.
  //
  // Duas correções, nenhuma no volume:
  //
  //  1. MOTIVO DIFERENTE. Quem declarou a peça no vocabulário novo diz "faz esse
  //     tipo de peça". Quem só encosta pela categoria antiga diz "pode fazer
  //     (categoria X)" — e a tela pinta diferente. Ordem sem motivo é mágica, e
  //     dois motivos iguais pra evidências diferentes é pior que mágica.
  //
  //  2. ESPECIFICIDADE PESA. `legadoDasPecas` devolve as categorias na ordem do
  //     catálogo, da mais específica pra menos: `uniforme` → ['fardamento',
  //     'interclasse']. Casar a PRIMEIRA vale mais que casar as seguintes.
  //     Medido em 135 pedidos com peça derivada: muda o 1º da lista em 28
  //     (20,7%) e o top-3 em 66 (48,9%) — e na direção certa (no 293, quem tem
  //     fardamento sobe acima de quem só tem interclasse).
  //
  // Os pesos abaixo são os que foram MEDIDOS. Em particular, a peça declarada
  // vale o mesmo que a primeira categoria legada (20): dar mais a ela seria uma
  // terceira mudança, não medida, num ranking que acabou de mudar duas vezes.
  // ==========================================================================
  const tipos = (f.tipos_produto ?? []).map(normalizar).filter(Boolean)
  const catPedido = normalizar(pedido.categoria)
  const legado = legadoDasPecas(pedidas)

  let pontosLegado = 0
  let legadoCasou: string | null = null
  if (catPedido && tipos.some((t) => t.includes(catPedido) || catPedido.includes(t))) {
    // A categoria do próprio pedido é o sinal mais direto que a era antiga tem.
    pontosLegado = PESO_CATEGORIA_PRINCIPAL
    legadoCasou = (pedido.categoria ?? '').trim()
  } else {
    for (let i = 0; i < legado.length; i++) {
      if (!tipos.includes(normalizar(legado[i]))) continue
      pontosLegado = i === 0 ? PESO_CATEGORIA_PRINCIPAL : PESO_CATEGORIA_SECUNDARIA
      legadoCasou = legado[i]
      break
    }
  }

  if (bateNoVocabularioNovo) {
    pontos += PESO_PECA_DECLARADA
    motivos.push(MOTIVO_PECA_DECLARADA)
  } else if (pontosLegado > 0) {
    pontos += pontosLegado
    motivos.push(`${MOTIVO_PECA_LEGADA} (${(legadoCasou ?? '').replace(/_/g, ' ')})`)
  }

  // Pedido mínimo, com 20% de margem pra baixo. Mínimo 30 aceita a partir de
  // 24: perto o bastante pra valer a pergunta. Abaixo disso não oferta — não é
  // pessimismo, é não gastar a paciência dela com pedido que não serve.
  if (totalPecas != null && f.pedido_minimo != null && totalPecas < f.pedido_minimo) {
    const piso = Math.ceil(f.pedido_minimo * (1 - MARGEM_PEDIDO_MINIMO))
    if (totalPecas >= piso) {
      pontos -= 10
      motivos.push(`pede ${f.pedido_minimo}, mas dá pra tentar`)
    } else {
      viavel = false
      pontos -= 60
      motivos.push(`mínimo ${f.pedido_minimo} peças`)
    }
  }

  // PRAZO NÃO ENTRA NO MATCH — decisão do Fernando, 09/09/2026.
  //
  // Eu tinha feito o prazo mínimo da confecção eliminar candidato, por simetria
  // com o pedido mínimo. Ele corrigiu, e a correção está certa: agenda de
  // confecção muda por semana. A que hoje só pega a partir de 21 dias porque
  // está cheia, na semana que vem topa 8 porque abriu buraco. Filtrar por isso
  // é descartar fornecedor por um dado que envelhece em dias — e o custo do
  // erro é assimétrico: perder quem toparia é pior que mandar pra quem recusa.
  //
  // O prazo do PEDIDO continua indo na oferta (ver ofertarPedido), que é onde
  // ele importa: quem decide se cabe na agenda é ela, na hora, olhando a
  // própria fila. `prazo_minimo_dias` fica como informação na tela, nunca como
  // filtro.
  if (pedido.prazoDias != null && f.prazo_minimo_dias != null && pedido.prazoDias < f.prazo_minimo_dias) {
    motivos.push(`costuma pegar a partir de ${f.prazo_minimo_dias} dias`)
  }

  if (f.status && f.status !== 'ativo') {
    pontos -= 15
    motivos.push(f.status)
  }

  return { pontos, motivos, viavel }
}

/** A mesma lista, na ordem em que faz sentido olhar pra ESTE pedido. */
export function ordenarFornecedoresPara<T extends FornecedorParaMatch & { nome: string | null }>(
  pedido: {
    cidade?: string | null
    uf?: string | null
    categoria?: string | null
    peca?: string | null
    pecas?: string[] | null
    /** Obrigatório: sem as linhas a peça não é derivável e o match degrada. */
    linhas: { modelo?: string | null }[] | null
    prazoDias?: number | null
  },
  fornecedores: T[],
  totalPecas?: number | null
): Array<T & { match: MatchFornecedor }> {
  return fornecedores
    .map((f) => ({ ...f, match: pontuarFornecedor(pedido, f, totalPecas) }))
    .sort((a, b) => b.match.pontos - a.match.pontos || (a.nome ?? '').localeCompare(b.nome ?? ''))
}
