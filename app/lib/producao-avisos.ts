// app/lib/producao-avisos.ts
// ============================================================================
// O que o cliente lê quando o pedido dele anda na fábrica.
//
// POR QUE OS TEXTOS MORAM AQUI, SEPARADOS
// `producao-etapas.ts` é a lista de colunas — o vocabulário interno, do chão de
// fábrica ("Encaixe, enfesto e corte"). O cliente não fala essa língua. Este
// arquivo é a tradução: uma frase por etapa, escrita pra quem está esperando
// uma camiseta, não pra quem corta malha.
//
// SEM IMPORT DE SERVIDOR: pode ser lido pelo painel do cliente também.
//
// REGRA DE ESCRITA
// Uma linha. Diz o que aconteceu e, quando dá, o que vem depois. Sem jargão,
// sem promessa de data — prazo quem dá é o fornecedor, e errar data aqui vira
// reclamação.
// ============================================================================

import { type Etapa } from './producao-etapas'

export type AvisoEtapa = {
  /** Vira o assunto do e-mail e o título no painel do cliente. */
  titulo: string
  /** Uma ou duas frases. */
  corpo: string
  /** Resumo curtíssimo pro template do WhatsApp (sem quebra de linha). */
  resumo: string
  /** WhatsApp só nas etapas em que a pessoa realmente quer ser interrompida. */
  whatsapp: boolean
}

export const AVISOS: Record<Etapa, AvisoEtapa> = {
  planejamento: {
    titulo: 'Seu pedido entrou na fila de produção',
    corpo:
      'Estamos fechando a grade, o prazo e a ficha técnica com a confecção. ' +
      'Assim que a produção começar de fato, a gente te avisa.',
    resumo: 'entrou na fila de produção',
    whatsapp: false,
  },
  compras: {
    titulo: 'Separando o material do seu pedido',
    corpo:
      'A confecção está comprando a malha, a linha e os aviamentos das suas peças. ' +
      'É a etapa que mais depende de fornecedor externo, então pode variar um pouco.',
    resumo: 'material sendo comprado',
    whatsapp: false,
  },
  design: {
    titulo: 'Fechando a arte do seu pedido',
    corpo:
      'Sua arte está sendo preparada para produção — fechamento de arquivo, cores e prova. ' +
      'Se algo na arte precisar mudar, este é o melhor momento pra falar com a gente.',
    resumo: 'arte em fechamento',
    whatsapp: false,
  },
  corte: {
    titulo: 'Começamos a produzir suas peças',
    corpo:
      'O tecido do seu pedido foi para a mesa de corte. A partir daqui as peças existem de verdade.',
    resumo: 'produção iniciada — peças no corte',
    whatsapp: false,
  },
  estamparia: {
    titulo: 'Sua estampa está sendo aplicada',
    corpo: 'As peças cortadas foram para a estamparia.',
    resumo: 'estampa sendo aplicada',
    whatsapp: false,
  },
  costura: {
    titulo: 'Suas peças estão na costura',
    corpo: 'Montagem e acabamento das peças. É a etapa mais longa da produção.',
    resumo: 'peças na costura',
    whatsapp: false,
  },
  expedicao: {
    titulo: 'Seu pedido está sendo embalado',
    corpo:
      'As peças passaram pela revisão e estão sendo dobradas e embaladas. Falta pouco.',
    resumo: 'em revisão e embalagem',
    whatsapp: false,
  },
  pronto: {
    titulo: 'Seu pedido está pronto! 🎉',
    corpo:
      'Terminamos suas peças. Em instantes a gente entra em contato para combinar o envio ou a retirada.',
    resumo: 'pedido PRONTO — vamos combinar envio ou retirada',
    whatsapp: true,
  },
}

/** Rótulo curto pro cliente, sem o jargão de fábrica. */
export function tituloParaCliente(etapa: Etapa): string {
  return AVISOS[etapa].titulo
}
