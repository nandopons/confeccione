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
  // ==========================================================================
  // VAZIO NÃO É UNISSEX — 12/09/2026.
  //
  // Isto era `pub && pub !== 'unissex' ? base + '|' + pub : base`, e colapsava
  // DOIS estados diferentes na mesma chave: "não sei o gênero" e "é unissex".
  // Uma peça de gênero desconhecido servia e recebia a imagem de uma unissex.
  //
  // Pior, os dois chamadores discordavam: o admin (api/admin/mockups) grava com
  // `chaveMockup(modelo, cor, material)` — SEM público — e o visualizador
  // (api/visualizador/mockup) lê com o público junto. Quem escreve e quem lê
  // usavam chaves diferentes sempre que havia gênero, então imagem posta pelo
  // admin era invisível pra metade das buscas. Dá pra ver o efeito nas chaves
  // gravadas: `camiseta dry fit|azul...|dry fit|masculino` e a MESMA
  // `camiseta dry fit|azul...|dry fit` convivem na tabela.
  //
  // Agora são três estados distintos, e o `?` é "não sei" — nunca casa com
  // gênero nenhum, que é a direção segura: repetir uma geração custa centavos,
  // entregar a modelagem do gênero errado custa o cliente.
  //
  // SOBRE "ZERO REUSO": a coluna `acessos` NÃO é incrementada por código nenhum
  // (grep no repo: nada escreve nela depois do insert). Ela vale 1 em todas as
  // 22 linhas porque é o default, não porque o cache nunca serviu. Não dá pra
  // concluir uso a partir dela — e foi assim que "22 acessos, zero reuso" quase
  // virou licença pra trocar a chave sem cuidado.
  // ==========================================================================
  if (!pub) return base + '|?'
  return base + '|' + pub
}
