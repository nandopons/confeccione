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
  /** Só costura (facção). Ver a migration 20260929000000. */
  faccao?: boolean | null
  /** Peças que ela disse que NÃO faz (ids do catálogo). Ver migration 20260929040000. */
  pecas_nao_faz?: string[] | null
  /** Histórico de resposta às ofertas (engajamento-fornecedor.ts). Ausente = nunca ofertada = neutro. */
  engajamento?: { respondidas: number; ignoradas: number; horasResposta: number | null } | null
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
/** Engajamento — 29/09/2026. Bônus por responder, desconto por deixar vencer. */
export const PESO_RESPONDE = 25
export const PESO_RESPONDE_RAPIDO = 10
export const PESO_IGNOROU = -15
export const TETO_IGNOROU = -60
/** Horas: abaixo disto é "responde rápido". */
export const HORAS_RAPIDO = 6

/** Ela disse que não faz a peça pedida. */
export const MOTIVO_NAO_FAZ = 'disse que não faz'

/** A confecção é facção (só costura). A tela pinta como tag. */
export const MOTIVO_FACCAO = 'facção'
/** Facção fora da cidade do pedido: a fila não oferta, a tela mostra o porquê. */
export const MOTIVO_FACCAO_LONGE = 'facção fora da cidade — o cliente teria que levar o tecido'

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

  // "ESSE PRODUTO NÃO FAÇO" — 29/09/2026 (decisão do Fernando). O que ela
  // recusou dizendo que não faz não volta pra ela: se TODA peça do pedido está
  // na lista, inviável; se parte, desconto forte. A lista vem do recusar_oferta
  // / desistir_do_pedido / salvar_perfil_producao (ids do catálogo).
  const naoFaz = new Set((f.pecas_nao_faz ?? []).filter(Boolean))
  const pedidasQueNaoFaz = pedidas.filter((q) => naoFaz.has(q))
  if (pedidas.length > 0 && pedidasQueNaoFaz.length === pedidas.length) {
    viavel = false
    pontos -= 80
    motivos.push(`${MOTIVO_NAO_FAZ} (${pedidasQueNaoFaz.map((q) => q.replace(/_/g, ' ')).join(', ')})`)
  } else if (pedidasQueNaoFaz.length > 0) {
    pontos -= 30
    motivos.push(`${MOTIVO_NAO_FAZ} ${pedidasQueNaoFaz.map((q) => q.replace(/_/g, ' ')).join(', ')}`)
  }
  // COBERTURA, NÃO ENCOSTO — 29/09/2026 (Samira × Joaquim). Pedido de
  // alfaiataria social feminina (vestido, saia, calça, colete, short social,
  // blusa social, macacão) foi pro Joaquim, que faz fitness — porque "short
  // social" vira `bermuda_short` e "blusa social" vira `blusa_top`, e ele
  // declara os dois. Duas peças em sete davam os 20 pontos inteiros de "faz
  // esse tipo de peça". Agora o ponto é proporcional à parte do pedido que
  // ela cobre, e quem cobre um terço ou menos de um pedido com 3+ peças
  // diferentes não recebe a oferta — o pedido é de outro ofício. Quem não
  // declarou peça nenhuma (só `tipos_produto` legado) não é afetado.
  const pedidasQueFaz = pedidas.filter((q) => fazPecasNovo.includes(q))
  const cobertura = pedidas.length > 0 ? pedidasQueFaz.length / pedidas.length : 0
  const bateNoVocabularioNovo = pedidasQueFaz.length > 0
  const coberturaInsuficiente = bateNoVocabularioNovo && pedidas.length >= 3 && cobertura <= 1 / 3
  if (coberturaInsuficiente) {
    viavel = false
    pontos -= 40
    motivos.push(`faz só ${pedidasQueFaz.length} de ${pedidas.length} peças do pedido`)
  }

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

  if (bateNoVocabularioNovo && cobertura >= 0.5) {
    pontos += PESO_PECA_DECLARADA
    motivos.push(pedidas.length > 1 && cobertura < 1 ? `${MOTIVO_PECA_DECLARADA} (${pedidasQueFaz.length} de ${pedidas.length})` : MOTIVO_PECA_DECLARADA)
  } else if (bateNoVocabularioNovo && !coberturaInsuficiente) {
    // Cobre menos da metade: vale proporcional, e o motivo diz quanto.
    pontos += Math.max(1, Math.round(PESO_PECA_DECLARADA * cobertura))
    motivos.push(`${MOTIVO_PECA_DECLARADA} (${pedidasQueFaz.length} de ${pedidas.length})`)
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

  // QUEM RESPONDE SOBE, QUEM IGNORA DESCE — 29/09/2026 (decisão do Fernando).
  //
  // Camada por cima de geografia e peça. Responder a maioria (aceitar OU
  // recusar — recusa rápida é engajamento) vale +25, e +10 se costuma
  // responder em menos de 6 h. Cada oferta que venceu sem resposta tira 15,
  // até −60: com quatro ignoradas a confecção fica abaixo de qualquer uma da
  // mesma cidade que nunca foi testada. Quem nunca recebeu oferta é neutra —
  // é o "ir testando" da decisão. Ver engajamento-fornecedor.ts.
  const e = f.engajamento
  if (e && (e.respondidas > 0 || e.ignoradas > 0)) {
    const total = e.respondidas + e.ignoradas
    if (e.respondidas >= 2 && e.respondidas / total >= 0.6) {
      pontos += PESO_RESPONDE
      motivos.push(`responde (${e.respondidas} de ${total})`)
      if (e.horasResposta != null && e.horasResposta < HORAS_RAPIDO) {
        pontos += PESO_RESPONDE_RAPIDO
        motivos.push(e.horasResposta < 1 ? 'responde em minutos' : `responde em ~${Math.round(e.horasResposta)} h`)
      }
    }
    if (e.ignoradas > 0) {
      pontos += Math.max(TETO_IGNOROU, PESO_IGNOROU * e.ignoradas)
      motivos.push(`ignorou ${e.ignoradas} oferta${e.ignoradas > 1 ? 's' : ''}`)
    }
  }

  // FACÇÃO SÓ CASA COM A PRÓPRIA CIDADE — 29/09/2026 (decisão do Fernando).
  //
  // Facção só costura: o cliente leva o tecido (muitas vezes já cortado) e
  // busca as peças pra fazer o resto. Isso só funciona perto. Fora da cidade a
  // fila automática não oferta (a Thannytt, em GO, aceitou o pedido da Kely, em
  // outro estado, e desistiu no dia seguinte); a tela continua mostrando, com o
  // motivo, porque o Fernando pode saber que o cliente tem logística própria.
  if (f.faccao) {
    const mesmaCidade = Boolean(cidadePedido && cidadeForn && cidadePedido === cidadeForn)
    if (mesmaCidade) {
      motivos.push(MOTIVO_FACCAO)
    } else {
      viavel = false
      pontos -= 40
      motivos.push(MOTIVO_FACCAO_LONGE)
    }
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
