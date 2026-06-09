// app/lib/mockup-cache.ts
// ============================================================================
// Helpers do cache de mockups lisos (tabela public.mockups_lisos).
// A CHAVE é o que liga geração e admin: precisa ser idêntica nos dois lados.
// chave = modelo|cor|material normalizado (NFD sem acento, minúsculo, espaços
// colapsados). Descrição NÃO entra na chave (permite reuso entre similares).
// ============================================================================

export function normMockup(s?: string | null): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

export function chaveMockup(
  modelo?: string | null,
  cor?: string | null,
  material?: string | null,
  publico?: string | null
): string {
  const base = [normMockup(modelo), normMockup(cor), normMockup(material)].join('|')
  const pub = normMockup(publico)
  // só segmenta quando há gênero específico — mantém as chaves 'unissex' antigas.
  return pub && pub !== 'unissex' ? base + '|' + pub : base
}
