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
  const bateNoVocabularioNovo = pedidas.length > 0 && fazPecasNovo.length > 0 && pedidas.some((q) => fazPecasNovo.includes(q))

  const querLegado = [pedido.categoria, ...legadoDasPecas(pedidas)].map(normalizar).filter(Boolean)
  const fazPecas: string[] = (f.tipos_produto ?? []).map(normalizar).filter(Boolean)
  const bateNoLegado = querLegado.length > 0 && fazPecas.length > 0 && querLegado.some((q) => fazPecas.some((p) => p.includes(q) || q.includes(p)))

  if (bateNoVocabularioNovo || bateNoLegado) {
    pontos += 20
    motivos.push('faz esse tipo de peça')
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
