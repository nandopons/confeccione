// app/lib/producao-etapas.ts
// ============================================================================
// Só as etapas de fábrica — sem nenhum import de servidor.
//
// POR QUE ESTE ARQUIVO EXISTE SEPARADO DE producao.ts
// `producao.ts` importa `supabaseAdmin`, que carrega a SERVICE ROLE. Componente
// com 'use client' que importasse a lista de lá arrastaria esse módulo pro
// bundle do browser — e a chave junto. Este arquivo é a metade que pode
// atravessar a fronteira: constantes puras, zero efeito.
//
// A ORDEM DESTA LISTA É A ORDEM DAS COLUNAS DO QUADRO. Mudar aqui muda o
// quadro do admin e o seletor do fornecedor de uma vez.
//
// Estamparia antes de Costura porque estampa em peça cortada e ainda aberta é
// o caminho comum em malha. Confecção que estampa depois de fechada é só
// trocar as duas de lugar aqui.
//
// Se acrescentar etapa, acrescente TAMBÉM no check da tabela producao_pedido
// (migration 20260820230000_producao_crm.sql) — senão o insert falha em
// produção, não no build.
// ============================================================================

export const ETAPAS = [
  { id: 'planejamento', titulo: 'Planejamento', ajuda: 'Grade fechada, prazo combinado, ficha técnica pronta' },
  { id: 'compras',      titulo: 'Compras',      ajuda: 'Falta comprar malha, linha ou aviamento' },
  { id: 'design',       titulo: 'Design',       ajuda: 'Arte final, fechamento de arquivo, prova' },
  { id: 'corte',        titulo: 'Corte',        ajuda: 'Encaixe, enfesto e corte' },
  { id: 'estamparia',   titulo: 'Estamparia',   ajuda: 'Silk, DTF ou sublimação' },
  { id: 'costura',      titulo: 'Costura',      ajuda: 'Montagem e acabamento' },
  { id: 'expedicao',    titulo: 'Expedição',    ajuda: 'Revisão, dobra, embalagem, etiqueta' },
  { id: 'pronto',       titulo: 'Pronto',       ajuda: 'Pronto para envio ou coleta' },
] as const

export type Etapa = (typeof ETAPAS)[number]['id']

const IDS_ETAPA: readonly string[] = ETAPAS.map((e) => e.id)

export function ehEtapa(v: unknown): v is Etapa {
  return typeof v === 'string' && IDS_ETAPA.includes(v)
}

export function tituloEtapa(id: string): string {
  return ETAPAS.find((e) => e.id === id)?.titulo ?? id
}
