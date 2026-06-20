// Fonte ÚNICA das mídias visuais de um pedido (o que o cliente montou/enviou).
// Prioriza 'imagens' (composição legada salva no confirm). Quando não houver
// imagens, usa os mockups por produto — fotos[] (novo modelo de múltiplas
// fotos) ou, no legado, arte/liso. Garante a mesma ordem/contagem usada tanto
// pra servir por índice (download do cliente, vitrine do fornecedor, e-mail)
// quanto pra contar quantas existem.
export type MapaMockups = Record<string, { liso?: string; arte?: string; fotos?: string[] }>

export function coletarVisuaisPedido(
  mockups: MapaMockups | null | undefined,
  imagens: unknown[] | null | undefined,
): string[] {
  const doImagens = Array.isArray(imagens)
    ? imagens.filter((x): x is string => typeof x === 'string' && x.length > 0)
    : []
  if (doImagens.length > 0) return doImagens

  const mapa = mockups && typeof mockups === 'object' ? mockups : {}
  const keys = Object.keys(mapa)
    .map(Number)
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b)
  const out: string[] = []
  for (const k of keys) {
    const v = mapa[String(k)] || {}
    if (Array.isArray(v.fotos) && v.fotos.length > 0) out.push(...v.fotos.filter(Boolean))
    else if (v.arte) out.push(v.arte)
    else if (v.liso) out.push(v.liso)
  }
  return out
}
