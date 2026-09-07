// app/lib/etapas-pedido-catalogo.ts
// ============================================================================
// CATÁLOGO DAS ETAPAS DO PEDIDO — só constantes, sem banco, pra poder ser
// importado por componentes de cliente (o admin) e pelo servidor.
// A etapa em si é calculada na view pedidos_assistente_etapas (D-8).
// ============================================================================

export const ETAPAS = [
  'rascunho',
  'captado',
  'pedido_completo',
  'inativo',
  'buscando_fornecedor',
  'sem_fornecedor',
  'em_negociacao',
  'orcamento_atrasado',
  'aguardando_pagamento',
  'sem_resposta',
  'orcamento_vencido',
  'pago',
  'em_producao',
  'pronto',
  'entregue',
  'finalizado',
  'encerrado',
  'cancelado',
] as const
export type Etapa = (typeof ETAPAS)[number]

export const GRUPOS = ['entrada', 'fornecedor', 'negociacao', 'pagamento', 'producao', 'fechado', 'perdido'] as const
export type GrupoEtapa = (typeof GRUPOS)[number]

export const MOTIVOS_ENCERRAMENTO = ['achou_caro', 'data', 'atendimento', 'sumiu', 'outro'] as const
export type MotivoEncerramento = (typeof MOTIVOS_ENCERRAMENTO)[number]

export const MOTIVO_LABEL: Record<MotivoEncerramento, string> = {
  achou_caro: 'Achou caro',
  data: 'Data não serviu',
  atendimento: 'Não gostou do atendimento',
  sumiu: 'Sumiu, não respondeu mais',
  outro: 'Outro',
}

export type InfoEtapa = {
  label: string
  grupo: GrupoEtapa
  /** Classes Tailwind do chip no admin. */
  cor: string
  alerta: boolean
  /** O que a etapa significa e qual é o próximo passo. */
  descricao: string
}

export const INFO_ETAPA: Record<Etapa, InfoEtapa> = {
  rascunho: { label: 'Rascunho', grupo: 'entrada', cor: 'bg-gray-100 text-gray-500', alerta: false, descricao: 'Ainda sem nome e WhatsApp.' },
  captado: { label: 'Captado', grupo: 'entrada', cor: 'bg-gray-100 text-gray-700', alerta: false, descricao: 'Deixou contato, mas a peça está incompleta (modelo, cor, quantidade). Régua: completar o pedido.' },
  pedido_completo: { label: 'Pedido completo', grupo: 'entrada', cor: 'bg-slate-200 text-slate-800', alerta: false, descricao: 'Peça completa, não clicou em "Buscar fornecedor". Régua: confirmar.' },
  inativo: { label: 'Inativo', grupo: 'entrada', cor: 'bg-gray-100 text-gray-400', alerta: false, descricao: 'Captado ou completo há mais de 30 dias sem nenhum toque. Reengajamento ou encerrar.' },
  buscando_fornecedor: { label: 'Buscando fornecedor', grupo: 'fornecedor', cor: 'bg-blue-50 text-blue-700', alerta: false, descricao: 'Confirmou; oferta em andamento nas últimas 24 h.' },
  sem_fornecedor: { label: 'Sem fornecedor', grupo: 'fornecedor', cor: 'bg-red-100 text-red-800', alerta: true, descricao: 'Confirmou há mais de 24 h sem aceite e sem oferta fresca. Captação puxada pelo pedido.' },
  em_negociacao: { label: 'Em negociação', grupo: 'negociacao', cor: 'bg-blue-100 text-blue-800', alerta: false, descricao: 'Fornecedor aceitou; orçamento ainda não definido.' },
  orcamento_atrasado: { label: 'Orçamento atrasado', grupo: 'negociacao', cor: 'bg-orange-100 text-orange-800', alerta: true, descricao: 'Aceite há mais de 48 h sem orçamento. Cutucar o fornecedor.' },
  aguardando_pagamento: { label: 'Aguardando pagamento', grupo: 'pagamento', cor: 'bg-amber-100 text-amber-800', alerta: false, descricao: 'Orçamento definido, cliente ainda não pagou.' },
  sem_resposta: { label: 'Sem resposta', grupo: 'pagamento', cor: 'bg-red-100 text-red-800', alerta: true, descricao: 'Orçamento enviado e 3 dias sem mensagem do cliente. Luigi: entender o motivo (data, preço, atendimento).' },
  orcamento_vencido: { label: 'Orçamento vencido', grupo: 'pagamento', cor: 'bg-gray-200 text-gray-600', alerta: false, descricao: 'Orçamento há mais de 21 dias. Fora do valor "aguardando"; recuperável ou encerrar com motivo.' },
  pago: { label: 'Pago', grupo: 'producao', cor: 'bg-green-100 text-green-800', alerta: false, descricao: 'Pagou; produção ainda não começou.' },
  em_producao: { label: 'Em produção', grupo: 'producao', cor: 'bg-green-100 text-green-800', alerta: false, descricao: 'Card de produção ativo.' },
  pronto: { label: 'Pronto', grupo: 'producao', cor: 'bg-emerald-100 text-emerald-800', alerta: false, descricao: 'Produção pronta; falta entregar.' },
  entregue: { label: 'Entregue', grupo: 'producao', cor: 'bg-emerald-200 text-emerald-900', alerta: false, descricao: 'Produção arquivada (entregue). Finalizar quando o cliente confirmar ou após 7 dias.' },
  finalizado: { label: 'Finalizado', grupo: 'fechado', cor: 'bg-[#0E1814] text-white', alerta: false, descricao: 'Ciclo fechado.' },
  encerrado: { label: 'Encerrado', grupo: 'perdido', cor: 'bg-red-50 text-red-700', alerta: false, descricao: 'Dado como perdido, com motivo.' },
  cancelado: { label: 'Cancelado', grupo: 'perdido', cor: 'bg-red-100 text-red-800', alerta: false, descricao: 'Cliente cancelou.' },
}

export const GRUPO_LABEL: Record<GrupoEtapa, string> = {
  entrada: 'Entrada',
  fornecedor: 'Fornecedor',
  negociacao: 'Negociação',
  pagamento: 'Pagamento',
  producao: 'Produção',
  fechado: 'Fechado',
  perdido: 'Perdido',
}

/** Etapas que contam como "em aberto" (o funil vivo). */
export const ETAPAS_ABERTAS: Etapa[] = ETAPAS.filter((e) => !['finalizado', 'encerrado', 'cancelado'].includes(e))

export function ehEtapa(v: unknown): v is Etapa {
  return typeof v === 'string' && (ETAPAS as readonly string[]).includes(v)
}

export function labelEtapa(e: string | null | undefined): string {
  return ehEtapa(e) ? INFO_ETAPA[e].label : e ?? '—'
}
