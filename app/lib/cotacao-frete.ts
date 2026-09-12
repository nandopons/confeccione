// app/lib/cotacao-frete.ts
// ============================================================================
// COTAR FRETE NA CONVERSA — 12/09/2026.
//
// A confecção precisa do frete pra dar preço ao cliente. Hoje ela só descobre
// dentro da tela de orçamento, depois de conectar a conta dela por OAuth. No
// meio de uma conversa isso é barreira: ela chuta o frete, erra a conta, e quem
// paga a diferença é ela.
//
// Aqui a cotação é INFORMAÇÃO, não operação. Emitir e pagar a etiqueta continua
// sendo dela, pela conta dela, exatamente como é hoje.
//
// O QUE ESTE ARQUIVO NÃO FAZ, DE PROPÓSITO:
//   • não infere a caixa pelo pedido — quem embala é ela, e errar a caixa pra
//     mais faz a transportadora cobrar a diferença DELA;
//   • não mistura os dois prazos. O prazo do FRETE sai aqui, porque é o que ela
//     precisa pra prometer entrega. O que some é o prazo de PRODUÇÃO na oferta
//     ao fornecedor: esse varia com a fila de máquina dela e perguntar na
//     sondagem produz chute. Um é do transporte, o outro é dela.
//   • não aplica o markup de 3%. Ver `precoDoServico` lá embaixo.
// ============================================================================

import type { ServicoCotado, VolumeFrete } from './melhorenvio'

/**
 * PISO DOS CORREIOS: 13 × 8 × 1 cm. Validado AQUI, antes da chamada.
 *
 * Abaixo disso a API recusa, e recusa com mensagem de validação — a conversa
 * morre num erro em vez de numa pergunta. Melhor perguntar a medida de novo.
 * (Jadlog não tem mínimo; quem manda no piso é Correios, que é quem sempre
 * aparece.)
 */
export const MIN_COMPRIMENTO_CM = 13
export const MIN_LARGURA_CM = 8
export const MIN_ALTURA_CM = 1

/**
 * Acima disto os Correios cobram taxa de manuseio, e a Jadlog (teto de 80 cm por
 * lado) some da lista. A lista encolher sem explicação parece defeito; dito em
 * palavras, é informação.
 */
export const LIMIAR_MANUSEIO_CM = 70

export type Caixa = { altura: number; largura: number; comprimento: number; pesoKg: number }

/**
 * Os três tamanhos prontos. Todos dentro dos limites reais: acima do piso dos
 * Correios, abaixo de 100 cm por lado, soma dos lados abaixo de 200, e abaixo
 * de 80 cm por lado (então a Jadlog também cota os três).
 */
export const CAIXAS_PRONTAS: Record<'P' | 'M' | 'G', Caixa & { rotulo: string }> = {
  P: { rotulo: 'P — 30×20×15 cm, até 2 kg', comprimento: 30, largura: 20, altura: 15, pesoKg: 2 },
  M: { rotulo: 'M — 40×30×25 cm, até 5 kg', comprimento: 40, largura: 30, altura: 25, pesoKg: 5 },
  G: { rotulo: 'G — 50×40×30 cm, até 10 kg', comprimento: 50, largura: 40, altura: 30, pesoKg: 10 },
}

/** Aviso dito UMA VEZ por conversa. Junta as duas ressalvas numa frase só: mais
 *  que isso e a cotação vira um bloco de letra miúda que ninguém lê. */
export const AVISO_COTACAO =
  'Esse valor é uma estimativa; o preço final sai na conta de vocês, e caixa maior que a cotada a transportadora cobra a diferença.'

export const AVISO_MANUSEIO =
  'Essa caixa só sai pelos Correios, e acima de 70 cm eles cobram taxa de manuseio.'

export type Validacao = { ok: true; volume: VolumeFrete; avisoManuseio: boolean } | { ok: false; erro: string }

/** Valida a caixa contra os limites reais ANTES de gastar uma chamada. */
export function validarCaixa(c: Caixa): Validacao {
  const { altura, largura, comprimento, pesoKg } = c
  if (![altura, largura, comprimento, pesoKg].every((n) => Number.isFinite(n) && n > 0)) {
    return { ok: false, erro: 'Me passa altura, largura, comprimento em cm e o peso em kg.' }
  }
  if (comprimento < MIN_COMPRIMENTO_CM || largura < MIN_LARGURA_CM || altura < MIN_ALTURA_CM) {
    return {
      ok: false,
      erro: `Essa medida é menor que o mínimo dos Correios (${MIN_COMPRIMENTO_CM}×${MIN_LARGURA_CM}×${MIN_ALTURA_CM} cm). Me passa a medida real da caixa fechada.`,
    }
  }
  const maior = Math.max(altura, largura, comprimento)
  return {
    ok: true,
    volume: { altura, largura, comprimento, peso: pesoKg },
    avisoManuseio: maior > LIMIAR_MANUSEIO_CM,
  }
}

/**
 * O PREÇO QUE ELA VÊ É O COTADO, SEM O MARKUP — 12/09/2026.
 *
 * `precoClienteDeLiquido` (3% de comissão, grossing up por /0,97) é aplicado
 * quando o ORÇAMENTO fecha, sobre o total. O frete cotado é o que ela paga na
 * transportadora, e ela recebe esse mesmo valor de volta no repasse — a
 * comissão não é markup sobre o frete.
 *
 * Mostrar o valor com markup aqui seria mentir sobre o custo dela. Pior: se ela
 * somar o valor com markup achando que é o custo, a comissão entra duas vezes,
 * a dela e a nossa que já está embutida.
 *
 * ATENÇÃO, e está no DEBT: a tela de orçamento mostra o valor COM markup
 * (pedido-assistente-oferta.ts:1045 faz o caminho inverso). Os dois números
 * estão certos e vão brigar na cabeça de quem olhar os dois.
 */
export function precoDoServico(s: ServicoCotado): number {
  return s.precoCentavos
}

function brl(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** A lista como ela chega no WhatsApp: transportadora, valor e prazo. */
export function formatarCotacao(servicos: ServicoCotado[]): string {
  return servicos
    .map((s) => {
      const dias = s.prazoDias > 0 ? `, ${s.prazoDias} ${s.prazoDias === 1 ? 'dia' : 'dias'}` : ''
      return `${s.transportadora} ${s.nome} — ${brl(precoDoServico(s))}${dias}`
    })
    .join('\n')
}
