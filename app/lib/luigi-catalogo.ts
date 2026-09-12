// app/lib/luigi-catalogo.ts
// ============================================================================
// LUIGI — só constantes (sem banco, sem SDK), pra poder ser importado pelo
// inbox (componente de cliente) e pelo servidor. A lógica mora em luigi.ts.
// ============================================================================

export const MODOS_LUIGI = ['desligado', 'sugere', 'responde'] as const
export type ModoLuigi = (typeof MODOS_LUIGI)[number]

export const MODO_LUIGI_LABEL: Record<ModoLuigi, string> = {
  desligado: 'Desligado',
  sugere: 'Sugere',
  responde: 'Responde sozinho',
}

/**
 * ESTE SELETOR É GLOBAL, E ISSO PRECISA ESTAR ESCRITO — 12/09/2026.
 *
 * O modo mora numa linha só em `agentes_config` e vale pra TODAS as conversas.
 * Como o seletor aparece dentro de uma conversa aberta, ele parece ser daquela
 * conversa: em 12/09 o Luigi foi desligado pra parar uma duplicação de pedido de
 * um cliente, e junto parou de atender todo mundo por duas horas.
 *
 * O aviso mora aqui, junto do texto de cada modo, pra sair na tela sempre —
 * não numa linha solta que a próxima refatoração do inbox descarta.
 */
export const MODO_LUIGI_GLOBAL = 'Vale para TODAS as conversas, não só esta.'

export const MODO_LUIGI_AJUDA: Record<ModoLuigi, string> = {
  desligado: `${MODO_LUIGI_GLOBAL} Só você responde, em todas elas. O Luigi não lê nem escreve nada.`,
  sugere: `${MODO_LUIGI_GLOBAL} A cada mensagem de cliente, o Luigi deixa a resposta pronta aqui no composer. Você lê, edita se quiser e manda.`,
  responde: `${MODO_LUIGI_GLOBAL} O Luigi responde clientes sozinho, dentro da janela de 24 h, com o contexto do pedido. Preço, reclamação e o que não está no pedido ele passa pra você. Fornecedores e o seu número ficam de fora.`,
}

export function ehModoLuigi(v: unknown): v is ModoLuigi {
  return typeof v === 'string' && (MODOS_LUIGI as readonly string[]).includes(v)
}

/** Sugestão pendente que o inbox mostra no composer (modo sugere). */
export type SugestaoLuigi = {
  id: string
  texto: string
  escalado: boolean
  motivo_escalada: string | null
  criado_em: string
}
