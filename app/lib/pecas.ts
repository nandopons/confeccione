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
