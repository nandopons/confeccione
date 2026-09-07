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

export const MODO_LUIGI_AJUDA: Record<ModoLuigi, string> = {
  desligado: 'Só você responde. O Luigi não lê nem escreve nada.',
  sugere: 'A cada mensagem de cliente, o Luigi deixa a resposta pronta aqui no composer. Você lê, edita se quiser e manda.',
  responde: 'O Luigi responde clientes sozinho, dentro da janela de 24 h, com o contexto do pedido. Preço, reclamação e o que não está no pedido ele passa pra você. Fornecedores e o seu número ficam de fora.',
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
