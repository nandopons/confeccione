// app/lib/pecas.ts
// ============================================================================
// CATÁLOGO DE PEÇAS — vocabulário único do cliente e do fornecedor.
//
// Decisão do Fernando (05/09/2026): o match por categoria ("Private Label",
// "Interclasse") não refinava. Categoria é OCASIÃO de compra, não capacidade de
// produção: saber que a confecção marcou "Private Label" não diz se ela faz
// polo. O fornecedor descreve o que faz do jeito dele — "produzimos vestidos,
// camisas, blusas, top, calças e saias" — e é essa lista que o cliente escolhe
// do outro lado. Mesmo vocabulário nas duas pontas, senão não há refinamento.
//
// PONTE COM O MODELO ANTIGO
// ---------------------------------------------------------------------------
// Os 41 fornecedores de hoje só têm `tipos_produto` (as categorias antigas).
// Se o pedido passasse a nascer só com peça, o matching não acharia ninguém.
// Por isso cada peça carrega as categorias legadas equivalentes: enquanto os
// dois lados não tiverem peça, o matching cai na categoria. É o que permite
// migrar sem desligar a rede.
// ============================================================================

export type Peca = {
  id: string
  label: string
  /** Exemplos, na linguagem de quem produz. Vira o subtítulo do card. */
  sub: string
  icon: string
  /** Categorias do modelo antigo que essa peça atende (ponte de migração). */
  legado: string[]
}

/** Cards da primeira dobra: o que mais aparece nos pedidos. */
export const PECAS_PRINCIPAIS: Peca[] = [
  { id: 'camiseta', label: 'Camisetas e t-shirts', sub: 'Malha, gola careca, oversized, baby look', icon: '👕', legado: ['interclasse', 'private_label', 'padrao_esportivo'] },
  { id: 'camisa_polo', label: 'Camisas e polos', sub: 'Social, polo, manga longa', icon: '🎽', legado: ['interclasse', 'fardamento', 'private_label'] },
  { id: 'blusa_top', label: 'Blusas e tops', sub: 'Cropped, regata, top, body', icon: '👚', legado: ['private_label', 'fitness'] },
  { id: 'vestido', label: 'Vestidos', sub: 'Curto, longo, midi, festa', icon: '👗', legado: ['private_label'] },
  { id: 'calca', label: 'Calças', sub: 'Alfaiataria, jeans, wide leg, jogger', icon: '👖', legado: ['private_label'] },
  { id: 'saia', label: 'Saias', sub: 'Curta, longa, plissada, shorts-saia', icon: '🩳', legado: ['private_label'] },
  { id: 'bermuda_short', label: 'Bermudas e shorts', sub: 'Sarja, moletom, tactel', icon: '🩳', legado: ['private_label', 'fitness'] },
  { id: 'moletom_jaqueta', label: 'Moletons, jaquetas e casacos', sub: 'Canguru, zíper, corta-vento, puffer', icon: '🧥', legado: ['inverno', 'private_label'] },
  { id: 'uniforme', label: 'Uniformes e fardamento', sub: 'Corporativo, escolar, operacional', icon: '🏢', legado: ['fardamento', 'interclasse'] },
  { id: 'fitness', label: 'Fitness e legging', sub: 'Legging, top, conjunto de treino', icon: '💪', legado: ['fitness', 'padrao_esportivo'] },
  { id: 'moda_praia', label: 'Moda praia', sub: 'Biquíni, sunga, saída de praia', icon: '🏖️', legado: ['moda_praia'] },
  { id: 'moda_intima', label: 'Moda íntima e pijamas', sub: 'Lingerie, pijama, sleepwear', icon: '🩱', legado: ['moda_intima'] },
]

/** Abre no "Outros": cauda longa, some da primeira dobra. */
export const PECAS_EXTRAS: Peca[] = [
  { id: 'bone', label: 'Bonés e chapéus', sub: 'Aba curva, trucker, bucket', icon: '🧢', legado: ['bones'] },
  { id: 'bolsa', label: 'Bolsas e mochilas', sub: 'Ecobag, mochila, necessaire', icon: '🎒', legado: ['bolsas'] },
  { id: 'colete', label: 'Coletes', sub: 'Alfaiataria, corporativo, refletivo', icon: '🦺', legado: ['private_label', 'fardamento'] },
  { id: 'macacao', label: 'Macacões e jardineiras', sub: 'Macaquinho, jardineira, macacão', icon: '🧵', legado: ['private_label'] },
  { id: 'blazer', label: 'Blazer e alfaiataria', sub: 'Blazer, terno, peças estruturadas', icon: '🕴️', legado: ['private_label', 'fardamento'] },
  { id: 'infantil', label: 'Roupa infantil', sub: 'Bebê, infantil, conjuntos', icon: '🧸', legado: ['private_label'] },
  { id: 'jaleco_avental', label: 'Jalecos e aventais', sub: 'Saúde, cozinha, estética', icon: '🥼', legado: ['fardamento'] },
  { id: 'uv', label: 'Proteção UV', sub: 'Camisa UV, esportes ao ar livre', icon: '☀️', legado: ['roupas_uv'] },
  { id: 'meia', label: 'Meias', sub: 'Cano curto, longo, esportiva', icon: '🧦', legado: ['private_label'] },
  { id: 'pet', label: 'Roupa pet', sub: 'Camiseta e casaco para pet', icon: '🐕', legado: ['private_label'] },
  { id: 'cama_mesa_banho', label: 'Cama, mesa e banho', sub: 'Toalha, jogo de cama, pano', icon: '🛏️', legado: ['private_label'] },
  { id: 'acessorios', label: 'Acessórios e brindes', sub: 'Bandana, faixa, chaveiro, brinde', icon: '🎁', legado: ['bolsas', 'brindes'] },
]

export const PECAS: Peca[] = [...PECAS_PRINCIPAIS, ...PECAS_EXTRAS]

const PORID = new Map(PECAS.map((p) => [p.id, p]))

export function pecaPorId(id: string | null | undefined): Peca | null {
  if (!id) return null
  return PORID.get(id) ?? null
}

export function pecaLabel(id: string | null | undefined): string {
  return pecaPorId(id)?.label ?? (id ?? '—')
}

export function pecaValida(id: unknown): id is string {
  return typeof id === 'string' && PORID.has(id)
}

/**
 * Categorias antigas equivalentes a uma lista de peças.
 *
 * Serve pra dois lados da ponte: preencher `tipos_produto` de um fornecedor que
 * se cadastrou por peça (pra ele entrar no matching antigo), e achar
 * fornecedores ainda não migrados a partir da peça de um pedido.
 */
export function legadoDasPecas(pecas: string[] | null | undefined): string[] {
  const out = new Set<string>()
  for (const id of pecas ?? []) {
    for (const cat of pecaPorId(id)?.legado ?? []) out.add(cat)
  }
  return [...out]
}

/** Peças que respondem por uma categoria antiga — usado ao migrar cadastros. */
export function pecasDoLegado(categoria: string | null | undefined): string[] {
  if (!categoria) return []
  return PECAS.filter((p) => p.legado.includes(categoria)).map((p) => p.id)
}

/**
 * Condição `.or()` do PostgREST pra "atende esta peça".
 *
 * Mesma ponte de sempre: quem já tem `pecas` casa pelo array novo; quem não
 * migrou casa pelas categorias legadas equivalentes. Vive aqui, e não copiada
 * em cada rota, porque filtro de admin que discorda do matching faz a tela
 * mostrar um conjunto de fornecedores e o sistema ofertar pra outro.
 */
export function condicaoPecaSupabase(peca: string): string {
  const legado = legadoDasPecas([peca])
  const condicoes = [`pecas.cs.{${peca}}`]
  if (legado.length > 0) condicoes.push(`tipos_produto.ov.{${legado.join(',')}}`)
  return condicoes.join(',')
}

// ============================================================================
// PÚBLICO E VESTUÁRIO — 12/09/2026.
//
// Mora aqui porque é vocabulário do domínio, do mesmo naipe do catálogo acima, e
// porque a lista de públicos já existia PRIVADA dentro de pedido-fechamento.ts.
// Duas cópias da mesma lista é o defeito que este repo já pagou várias vezes: a
// segunda cópia diverge e ninguém vê. Uma lista, dois leitores.
// ============================================================================

export const PUBLICOS = ['feminino', 'masculino', 'infantil', 'unissex'] as const

export function ehPublicoValido(v: unknown): boolean {
  return typeof v === 'string' && (PUBLICOS as readonly string[]).includes(v.trim().toLowerCase())
}

/**
 * Palavras de modelo que NÃO são roupa: brinde, gráfica, acessório sem corpo.
 *
 * Medido nas 534 linhas de produção: 17 caem aqui (3,2%) — caneca, squeeze,
 * crachá, caderno, caneta, chaveiro, copo térmico, mochila, sacochila, boné.
 * As outras 517 são vestuário ou têm `modelo` vazio.
 */
const PALAVRAS_NAO_VESTUARIO = [
  'caneca', 'squeeze', 'garrafa', 'copo', 'tumbler', 'túmbler', 'crachá', 'cracha',
  'caderno', 'caneta', 'chaveiro', 'adesivo', 'adesivos', 'banner', 'placa', 'mousepad',
  'marcador', 'botton', 'bottom', 'botom', 'ímã', 'ima', 'lanyard', 'cordão', 'sacola',
  'sacochila', 'ecobag', 'mochila', 'bolsa', 'necessaire', 'pochete', 'estojo',
  'boné', 'bone', 'bonés', 'bones', 'chapéu', 'chapeu', 'viseira', 'touca', 'gorro',
  'meia', 'meias', 'toalha', 'almofada', 'lençol', 'lencol', 'pano de prato',
]

/**
 * `\b` NÃO SERVE AQUI — 12/09/2026.
 *
 * A primeira versão era `/\b(caneca|bon[ée]|crach[áa]|…)\b/i` e deixava
 * "boné trucker" passar como vestuário. Em JavaScript o `\b` é ASCII: `é` não
 * é caractere de palavra, então entre `é` e o espaço NÃO existe fronteira e o
 * `\b` final falha. Só quebra nas palavras com acento no FIM — "cordão" passava
 * porque o acento é interno. "crachá" só era pego de carona pelo "cordão" ao
 * lado; sozinho, escaparia.
 *
 * Mesma família da armadilha do nono dígito no AGENTS.md: regra de fronteira que
 * parece certa e falha calada num subconjunto do dado real.
 */
const NAO_VESTUARIO = new RegExp(
  `(?<!\\p{L})(?:${PALAVRAS_NAO_VESTUARIO.join('|')})(?!\\p{L})`,
  'iu'
)

/**
 * A linha é peça de vestir? Decide se `publico` é exigível.
 *
 * DIREÇÃO DA FALHA, e é o oposto da do verificador de prévia: aqui o padrão é
 * EXIGIR, e só a lista fechada acima escapa. O custo dos dois erros não é
 * simétrico — exigir público de uma caneca custa UMA pergunta a mais do agente;
 * não exigir de uma camiseta manda pro cliente uma prévia com a modelagem do
 * gênero errado, que é a falha cara e silenciosa. Peça desconhecida cai no lado
 * seguro: pergunta.
 *
 * Por que pelo texto de `modelo` e não por um campo: não existe campo. Medido —
 * `linhas[].categoria` mistura dois vocabulários e carrega a lista do PEDIDO
 * colada na linha, e `pedidos_assistente.peca` só existe em 31 dos 229 pedidos.
 * O texto de `modelo` é o único sinal por linha que a base realmente tem.
 */
export function ehVestuario(modelo: string | null | undefined): boolean {
  const t = (modelo || '').trim()
  if (!t) return false
  return !NAO_VESTUARIO.test(t)
}

// ============================================================================
// DE `modelo` PRA PEÇA — 12/09/2026 (Fase 2, passo 1).
//
// `linhas[].modelo` é texto livre e carrega TRÊS níveis juntos: a peça
// ("camiseta"), o modelo ("calça wide leg") e a variação ("manga curta"). Média
// de 2,4 palavras. O catálogo acima é o vocabulário do matching, e só 31 dos 229
// pedidos têm `pecas` preenchido — porque esse campo é DECLARAÇÃO feita na
// criação (os cards do site), nunca recalculada. Pedido do Luigi e da vitrine
// nascem com zero.
//
// Esta tabela não adivinha: ou o texto casa com um termo conhecido, ou devolve
// `null`. "Não sei" é resposta melhor que palpite — peça errada manda o pedido
// pra confecção errada, e o ativo escasso aqui é paciência de fornecedor.
//
// ORDEM IMPORTA, e é a maior fonte de erro:
//   • "camiseta" antes de "camisa", senão toda camiseta vira polo
//   • "camisola" antes de "camisa" (é moda íntima, não camisa)
//   • "blusa de frio" antes de "blusa"
//   • "pijama"/"baby doll" antes de "short", senão "short de pijama" vira bermuda
// A primeira regra que casar vence, então o específico vem sempre antes do geral.
//
// O QUE FICA DE FORA DE PROPÓSITO: beca acadêmica, estola e kimono (5 linhas).
// Um id novo no catálogo vira card na tela do cliente e item na autodescrição do
// fornecedor — card que ninguém escolhe é ruído nas duas pontas. Se formatura
// virar segmento, isso muda, e é decisão de produto, não de classificação.
// ============================================================================

/** Fronteira que respeita acento — `\b` é ASCII e falha depois de "é"/"ã". */
function termo(t: string): RegExp {
  return new RegExp(`(?<!\\p{L})${t}(?!\\p{L})`, 'iu')
}

const SINONIMOS: { peca: string; termos: string[] }[] = [
  // `pet` PRIMEIRO: é qualificador, não tipo de peça. "pijama pet" e "vestido
  // pet" são roupa de cachorro — quem produz é outra confecção. Deixado no meio
  // da lista, "pijama pet" casava com moda_intima e ia pro fornecedor errado.
  { peca: 'pet', termos: ['pets?'] },
  // --- específicos primeiro ---
  { peca: 'moda_intima', termos: ['baby ?doll', 'short ?doll', 'camisola', 'pijamas?', 'cuecas?', 'calcinhas?', 'suti[ãa]s?', 'lingerie', 'cinto-?liga', 'sleepwear'] },
  { peca: 'moletom_jaqueta', termos: ['blusa de frio', 'corta-? ?vento', 'moletons?', 'moletom', 'jaquetas?', 'casacos?', 'college', 'puffer', 'canguru'] },
  { peca: 'camiseta', termos: ['camisetas?', 'tshi[rt]t?', 't-shirts?', 'baby ?look', 'oversized', 'cropped', 'ringer', 'dry ?fit', 'boxy', 'gola careca'] },
  { peca: 'uniforme', termos: ['uniformes?', 'fardamentos?', 'scrubs?'] },
  { peca: 'jaleco_avental', termos: ['jalecos?', 'aventais?', 'avental'] },
  { peca: 'macacao', termos: ['macac[ãa]o', 'macaquinho', 'jardineiras?'] },
  { peca: 'blazer', termos: ['blazers?', 'ternos?'] },
  { peca: 'colete', termos: ['coletes?'] },
  { peca: 'moda_praia', termos: ['moda praia', 'biqu[íi]nis?', 'sungas?', 'mai[ôo]s?', 'sa[íi]da de praia'] },
  { peca: 'fitness', termos: ['fitness', 'leggings?', 'top de treino'] },
  { peca: 'bone', termos: ['bon[ée]s?', 'chap[ée]us?', 'viseiras?', 'toucas?', 'gorros?'] },
  { peca: 'bolsa', termos: ['mochilas?', 'sacochilas?', 'eco ?bags?', 'tote ?bags?', 'necessaires?', 'pochetes?', 'bolsas?'] },
  { peca: 'meia', termos: ['meias?'] },
  { peca: 'cama_mesa_banho', termos: ['toalhas?', 'len[çc][óo]is', 'jogo de cama', 'pano de prato', 'cama,? mesa e banho'] },
  { peca: 'uv', termos: ['prote[çc][ãa]o uv', 'camisa uv', '\\buv\\b'] },
  { peca: 'infantil', termos: ['beb[êe]', 'infantis'] },
  { peca: 'vestido', termos: ['vestidos?'] },
  { peca: 'saia', termos: ['saias?'] },
  // --- gerais depois ---
  { peca: 'camisa_polo', termos: ['polos?', 'camisas?'] },
  { peca: 'blusa_top', termos: ['blusas?', 'regatas?', 'tops?', 'bodys?', 'batas?'] },
  { peca: 'calca', termos: ['cal[çc]as?'] },
  { peca: 'bermuda_short', termos: ['bermudas?', 'shorts?'] },
  { peca: 'acessorios', termos: ['bandanas?', 'faixas?', 'chaveiros?', 'brindes?', 'canecas?', 'squeezes?', 'garrafas?', 'copos?', 'crach[áa]s?', 'cadernos?', 'canetas?', 'estojos?', 'planners?', 'calend[áa]rios?', 'pastas?', 'porta-?cart[ãa]o', 'l[áa]pis', 'mousepads?', 'adesivos?', 'marcadores?'] },
]

const COMPILADO = SINONIMOS.map((s) => ({ peca: s.peca, res: s.termos.map(termo) }))

/**
 * A peça do catálogo que este `modelo` descreve, ou `null` se não der pra saber.
 *
 * `null` cobre três coisas diferentes e todas legítimas: modelo vazio (98
 * linhas), nome de CATEGORIA no campo errado ("private label", "interclasse /
 * evento" — 10 linhas) e variação usada como modelo ("manga longa" — 3 linhas).
 * Nenhuma delas diz qual é a peça, e nenhuma deve virar palpite.
 */
export function pecaDaLinha(modelo: string | null | undefined): string | null {
  const t = (modelo || '').trim()
  if (!t) return null
  for (const { peca, res } of COMPILADO) {
    if (res.some((re) => re.test(t))) return peca
  }
  return null
}

/**
 * As peças que as linhas de um pedido pedem, sem repetir e sem os "não sei".
 *
 * Vazio é resposta possível: pedido só de brinde sem nome reconhecido, ou
 * pedido em montagem com todos os modelos em branco. Quem chama decide o que
 * fazer com o vazio — ver `pecasDoPedido` em matching.ts.
 */
export function pecasDasLinhas(linhas: { modelo?: string | null }[] | null | undefined): string[] {
  const out = new Set<string>()
  for (const l of linhas ?? []) {
    const p = pecaDaLinha(l?.modelo)
    if (p) out.add(p)
  }
  return [...out]
}

// ============================================================================
// AS PEÇAS DO PEDIDO — DERIVADAS NA LEITURA (Fase 2, passo 2) — 12/09/2026.
//
// `pedidos_assistente.pecas` NÃO é derivado de nada: é DECLARAÇÃO feita na
// criação, a partir dos cards que o cliente marcou no site, escrita uma vez em
// `criar/route.ts` e nunca recalculada. Daí 31 de 229 pedidos — e zero nos 7 do
// Luigi e nos 4 da vitrine, que não passam por card nenhum. Pior: 14 dos 31 já
// tiveram as linhas editadas depois, então a coluna descreve uma intenção velha.
//
// POR QUE DERIVAR NA LEITURA E NÃO MANTER CACHE
// Existem NOVE lugares que escrevem `pedidos_assistente.linhas`. Um cache
// derivado exigiria que todos os nove lembrassem de recalcular; o que esquecesse
// deixaria `pecas` velho e o matching estreitaria em silêncio — o mesmo defeito
// que este repo já pagou seis vezes (ver a FAMÍLIA no topo do DEBT.md).
// Derivando na leitura não há o que esquecer: a regra some do caminho de escrita.
// Isso só é possível porque `pedidos_assistente.pecas` NUNCA entra em filtro SQL
// sobre pedidos — é lido em JS, de uma linha já carregada. (O `pecas.ov.{…}` de
// matching.ts e o `pecas.cs.{}` daqui filtram `leads_fornecedores`, outra tabela.)
//
// SUBSTITUIÇÃO COM PISO, decisão do Fernando, e o motivo é o custo do erro:
//   derivado não-vazio → vence o declarado
//   derivado vazio     → mantém o declarado (nunca devolve lista vazia por cima)
// União preservaria intenção velha pra sempre: o cliente que declarou camiseta e
// depois trocou as linhas por moletom continuaria pontuando confecção de
// camiseta. Oferta errada queima paciência de fornecedor, que é o ativo que não
// se repõe; pedido que alcança menos fornecedor a gente reoferece.
//
// `linhas` É OBRIGATÓRIO NO TIPO de propósito. Quem carregar o pedido sem as
// linhas não degrada calado pro piso — não compila. É a mesma trava que achou os
// três chamadores de `gerarMockupDoModelo`. Cuidado extra: existe uma COLISÃO DE
// NOME no repo — em `contexto/route.ts`, `FunilPainel` e `WhatsAppInbox`, o campo
// `pecas` de um objeto de pedido é a QUANTIDADE de peças (number). Se um desses
// chegasse aqui, `pedido.pecas.length > 0` seria `undefined > 0` = false e cairia
// no piso sem avisar. O tipo abaixo recusa number.
// ============================================================================

export type PedidoParaPecas = {
  /** Obrigatório: é de onde a peça sai. Ver o comentário acima. */
  linhas: { modelo?: string | null }[] | null
  /** Declaração de criação — só é usada quando não dá pra derivar nada. */
  peca?: string | null
  pecas?: string[] | null
}

export function pecasDoPedido(pedido: PedidoParaPecas): string[] {
  const derivadas = pecasDasLinhas(pedido.linhas)
  if (derivadas.length > 0) return derivadas
  if (pedido.pecas && pedido.pecas.length > 0) return pedido.pecas
  return pedido.peca ? [pedido.peca] : []
}
