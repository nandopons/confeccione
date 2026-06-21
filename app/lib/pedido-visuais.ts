// Fonte ÚNICA das mídias visuais de um pedido (o que o cliente montou/enviou).
// Garante a mesma ordem/contagem usada pra servir por índice (download do
// cliente, vitrine do fornecedor, e-mail) e pra contar quantas existem.
//
// Prioridade (corrige o caso em que sobrava uma 'imagens' legada e escondia as
// fotos novas dos mockups):
//   1) Fotos por produto (mockups[i].fotos[]) — o modelo ATUAL de upload.
//   2) Imagens legadas (campo 'imagens', composição salva no confirm antigo).
//   3) Arte/liso por produto (mockups legado, sem fotos[]).
export type MapaMockups = Record<string, { liso?: string; arte?: string; fotos?: string[]; ia?: { url: string; prompt?: string }[] }>

export function coletarVisuaisPedido(
  mockups: MapaMockups | null | undefined,
  imagens: unknown[] | null | undefined,
): string[] {
  const mapa = mockups && typeof mockups === 'object' ? mockups : {}
  const keys = Object.keys(mapa)
    .map(Number)
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b)

  // 1) Fotos por produto (modelo atual) + mockups gerados por IA.
  const fotos: string[] = []
  for (const k of keys) {
    const v = mapa[String(k)] || {}
    if (Array.isArray(v.fotos)) fotos.push(...v.fotos.filter((x) => typeof x === 'string' && x.length > 0))
    if (Array.isArray(v.ia)) fotos.push(...v.ia.map((it) => it?.url).filter((x): x is string => typeof x === 'string' && x.length > 0))
  }
  if (fotos.length > 0) return fotos

  // 2) Imagens legadas (composição do confirm antigo).
  const doImagens = Array.isArray(imagens)
    ? imagens.filter((x): x is string => typeof x === 'string' && x.length > 0)
    : []
  if (doImagens.length > 0) return doImagens

  // 3) Arte/liso por produto (mockups legado).
  const out: string[] = []
  for (const k of keys) {
    const v = mapa[String(k)] || {}
    if (v.arte) out.push(v.arte)
    else if (v.liso) out.push(v.liso)
  }
  return out
}
