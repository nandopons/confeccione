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
