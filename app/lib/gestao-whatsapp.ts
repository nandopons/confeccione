// app/lib/gestao-whatsapp.ts
// ============================================================================
// AGENTE DE GESTÃO NO WHATSAPP — a reunião das 07:00 e das 17:30 (D-7).
//
// Como funciona:
//   1. O cron (/api/cron/reuniao-manha e /reuniao-tarde) monta a pauta a
//      partir do diário de bordo e manda pro WhatsApp do Fernando, pelo número
//      oficial da Confeccione: texto livre se a janela de 24 h estiver aberta,
//      senão o template `reuniao_gestao`.
//   2. Quando o Fernando responde, o webhook reconhece o número dele
//      (WHATSAPP_GESTAO_NUMEROS) e chama responderGestao(): o histórico da
//      conversa vira contexto, o Claude consulta o diário pelas ferramentas
//      abaixo, responde curto e a resposta sai pela Cloud API.
//
// O que o agente pode fazer aqui: LER (placar, filas, funil por etapa,
// decisões, atas) e REGISTRAR (decisão, ata, pendência feita, foto do placar,
// motivo de parada) — e, por decisão explícita do Fernando na conversa,
// ENCERRAR um pedido como perdido com motivo (D-8). O que ele NÃO pode: mandar
// mensagem a cliente ou fornecedor, cobrar, mudar oferta ou orçamento — não
// existe ferramenta pra isso, de propósito (níveis de autonomia, seção 3 do
// sistema operacional). Só responde a números da allowlist.
//
// Cada resposta fica em gestao_whatsapp_log (mensagem, resposta, ferramentas,
// tokens, erro): é o que permite treinar o agente lendo onde ele errou.
// ============================================================================

import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from './supabase-server'
import { enviarTemplate, enviarTexto, marcarComoLida, normalizarWaId } from './whatsapp-cloud'
import { janela24hAberta, registrarSaidaInbox } from './whatsapp-notify'
import { registrarUsoIa } from './uso-ia'
import {
  concluirPendencia,
  conversasSemResposta,
  filaCobranca,
  gravarPlacar,
  listarDecisoes,
  pedidosSemFornecedor,
  registrarDecisao,
  registrarReuniao,
  resumoGestao,
  TEMAS_DECISAO,
  TIPOS_REUNIAO,
  type Pendencia,
  type TipoReuniao,
} from './diario'
import {
  acharPedido,
  contagemPorEtapa,
  encerrarPedido,
  ETAPAS,
  INFO_ETAPA,
  MOTIVOS_ENCERRAMENTO,
  pedidosPorEtapa,
  reabrirPedidoEncerrado,
  registrarMotivoParada,
  type Etapa,
  type MotivoEncerramento,
} from './etapas-pedido'
import { corrigirOrcamento } from './orcamento-versoes'
import { enviarRascunho, prepararMensagem } from './mcp-mensagens'
import { buscarContato, detalhePedido, lerConversa } from './gestao-consulta'
import { captarParaPedido, REGIOES, type RegiaoBusca } from './captacao-pedido'
import { editarLinhasPedidoCliente } from './pedido-linhas-edicao'
import { type LinhaPedido } from './pedido-assistente-oferta'

const MODELO = 'claude-sonnet-4-6'
/**
 * Quantas voltas de ferramenta o agente pode dar numa resposta.
 *
 * Era 6, de quando ele só lia placar e fila. Com buscar_contato,
 * detalhe_pedido, ler_conversa e preparar_mensagem, uma tarefa comum ("responde
 * o fulano") já gasta 4 — e um pedido com três pessoas estourava no meio,
 * deixando o Fernando esperando um "um segundo" que nunca terminava
 * (09/09/2026, 13:45).
 *
 * O limite que manda de verdade é o TEMPO, não este número: a rota tem
 * maxDuration = 120 s e a Vercel mata a função no talo, sem resposta e sem log.
 * Medido em produção, cada rodada leva ~5 s, então cabem ~20. Este teto fica
 * alto o bastante pra nunca ser ele a cortar uma tarefa legítima, e serve só
 * como rede contra loop (modelo chamando a mesma ferramenta pra sempre) —
 * cada rodada reenvia todo o histórico, então loop solto custa dinheiro.
 */
const MAX_RODADAS = 40

/**
 * Quanto tempo o loop pode gastar antes de fechar a resposta por conta própria.
 * Abaixo do maxDuration da rota, pra sobrar folga pro envio da mensagem e pro
 * log — melhor ele mesmo encerrar e avisar do que ser morto no meio.
 */
const ORCAMENTO_MS = 95_000
const MAX_TOKENS_RESPOSTA = 1200
/**
 * QUANTAS MENSAGENS ELE LEMBRA — 30 → 200 em 09/09/2026.
 *
 * Com 30 ele enxergava cerca de uma hora de conversa de dia cheio. No dia 09/09
 * ele disse ao Fernando, com razão: "não tenho memória do que foi dito antes do
 * início desta conversa; o que aparece pra mim começa em 'mete bronca'" — e por
 * isso repetia pergunta já respondida e perdia decisão tomada de manhã.
 *
 * A conta de sete dias inteiros dessa conversa deu 241 mensagens e ~11 mil
 * tokens: a memória COMPLETA da semana custa menos que o prompt de sistema.
 * Trinta não estava economizando nada relevante; estava só apagando o contexto
 * de quem precisa dele. Duzentas cobrem quase a semana toda.
 *
 * O que 200 NÃO resolve: memória de meses. Isso é o diário de bordo
 * (buscar_decisoes, buscar_reunioes, resumo_gestao) — janela grande é pra
 * continuidade da conversa, ferramenta é pra história da empresa.
 */
const HISTORICO_MENSAGENS = 200
const LIMITE_TEXTO_WHATSAPP = 3500

/** Template de abertura fora da janela de 24 h: {{1}} = hora, {{2}} = resumo em uma linha. */
export const TEMPLATE_REUNIAO_GESTAO = 'reuniao_gestao'

export type TipoReuniaoDiaria = Extract<TipoReuniao, 'manha' | 'tarde'>

// ─── Quem é gestor ──────────────────────────────────────────────────────────

/** Números (wa_id) que o agente atende. Vem de WHATSAPP_GESTAO_NUMEROS, separados por vírgula. */
export function numerosGestao(): string[] {
  return (process.env.WHATSAPP_GESTAO_NUMEROS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizarWaId)
    .filter((n) => n.replace(/\D/g, '').length >= 10)
}

export function ehNumeroGestao(waId: string): boolean {
  const alvo = normalizarWaId(waId)
  return numerosGestao().some((n) => n === alvo || n.slice(-8) === alvo.slice(-8))
}

// ─── Utilidades ─────────────────────────────────────────────────────────────

function agoraRecife(): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Recife',
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date())
}

export function horaRecife(agora = new Date()): number {
  return Number(new Intl.DateTimeFormat('en', { timeZone: 'America/Recife', hour: 'numeric', hour12: false }).format(agora))
}

function reais(centavos: number | null | undefined): string {
  return (Number(centavos ?? 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** Markdown vira o pouco que o WhatsApp entende: *negrito*, sem títulos, sem tabelas. */
function paraWhatsApp(texto: string): string {
  return (
    texto
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*(.+?)\*\*/g, '*$1*')
      .replace(/^\s*[-•]\s+/gm, '- ')
      // Travessão fora: no WhatsApp é assinatura de texto gerado. Preserva o
      // "- " de início de linha, que aqui é marcador de lista de verdade.
      .replace(/(?<!^)\s*[—–]\s*/gm, ', ')
      .replace(/,\s*([,.;:!?])/g, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

/** Quebra em blocos de até LIMITE_TEXTO_WHATSAPP chars, de preferência em parágrafo. */
function partirTexto(texto: string): string[] {
  if (texto.length <= LIMITE_TEXTO_WHATSAPP) return [texto]
  const partes: string[] = []
  let resto = texto
  while (resto.length > LIMITE_TEXTO_WHATSAPP) {
    let corte = resto.lastIndexOf('\n\n', LIMITE_TEXTO_WHATSAPP)
    if (corte < LIMITE_TEXTO_WHATSAPP / 2) corte = resto.lastIndexOf('\n', LIMITE_TEXTO_WHATSAPP)
    if (corte < LIMITE_TEXTO_WHATSAPP / 2) corte = LIMITE_TEXTO_WHATSAPP
    partes.push(resto.slice(0, corte).trim())
    resto = resto.slice(corte).trim()
  }
  if (resto) partes.push(resto)
  return partes
}

function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ─── Envio pro gestor ───────────────────────────────────────────────────────

export type EnvioGestor = { ok: true; wamid: string; template: string | null } | { ok: false; erro: string }

/**
 * Manda texto pro gestor. Dentro da janela de 24 h vai como texto livre; fora,
 * só o template de abertura passa — o texto completo fica pra primeira
 * resposta do agente. Espelha no inbox pra história ficar em /admin/whatsapp.
 */
export async function enviarParaGestor(
  waId: string,
  texto: string,
  abertura: { hora: string; resumo: string }
): Promise<EnvioGestor> {
  const partes = partirTexto(texto)
  if (await janela24hAberta(waId)) {
    let ultimo: EnvioGestor = { ok: false, erro: 'nada enviado' }
    for (const parte of partes) {
      const r = await enviarTexto(waId, parte)
      if (!r.ok) return { ok: false, erro: r.erro }
      await registrarSaidaInbox(waId, null, r.wamid, parte, null, 'gestao')
      ultimo = { ok: true, wamid: r.wamid, template: null }
    }
    return ultimo
  }

  const resumo = abertura.resumo.replace(/\s*\n+\s*/g, ' · ').replace(/\s{2,}/g, ' ').trim().slice(0, 300)
  const r = await enviarTemplate(waId, TEMPLATE_REUNIAO_GESTAO, 'pt_BR', [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: abertura.hora },
        { type: 'text', text: resumo },
      ],
    },
  ])
  if (!r.ok) return { ok: false, erro: r.erro }
  await registrarSaidaInbox(
    waId,
    null,
    r.wamid,
    `Fernando, a pauta da reunião das ${abertura.hora} está pronta: ${resumo}. Responde aqui pra começarmos.`,
    TEMPLATE_REUNIAO_GESTAO,
    'gestao'
  )
  return { ok: true, wamid: r.wamid, template: TEMPLATE_REUNIAO_GESTAO }
}

// ─── Ferramentas do agente ──────────────────────────────────────────────────
//
// Até 08/09/2026 eram só leitura e registro. Desde 09/09 o agente também
// corrige orçamento, reabre pedido e fala com cliente — as mesmas quatro que o
// servidor MCP ganhou, sobre as mesmas libs, pra não existirem duas regras.
//
// Por que aqui é aceitável ter ação com efeito externo: este agente só
// responde ao número do Fernando (WHATSAPP_GESTAO_NUMEROS, verificado no
// webhook). Quem fala com cliente desconhecido é o Luigi, e é por isso que o
// Luigi NÃO tem estas ferramentas — texto de terceiro não pode virar comando.
//
// Mensagem a cliente continua em duas etapas: preparar_mensagem devolve o
// texto, o Fernando lê no WhatsApp, e só então enviar_rascunho manda.

const FERRAMENTAS: Anthropic.Messages.Tool[] = [
  {
    name: 'resumo_gestao',
    description:
      'Placar de agora (7 e 30 dias + filas abertas), última foto gravada, decisões vencendo revisão, decisões recentes, ' +
      'pendências abertas das últimas atas e últimas reuniões. Comece por aqui em toda reunião.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'fila_cobranca',
    description: 'Quem tem orçamento definido e ainda não pagou (pedidos do chat + orçamentos avulsos com cobrança gerada), do mais antigo pro mais novo.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'conversas_sem_resposta',
    description: 'Conversas do WhatsApp oficial em que a última mensagem é do contato e está sem resposta há mais de N horas (padrão 2).',
    input_schema: { type: 'object', properties: { horas: { type: 'number', minimum: 1, maximum: 168 } } },
  },
  {
    name: 'pedidos_sem_fornecedor',
    description: 'Pedidos confirmados sem nenhuma oferta aceita há mais de N horas (padrão 24), com ofertas no ar e recusadas.',
    input_schema: { type: 'object', properties: { horas: { type: 'number', minimum: 1, maximum: 720 } } },
  },
  {
    name: 'buscar_decisoes',
    description: 'Decisões do diário de bordo (D-1, D-2…). Consulte antes de propor algo que pode já ter sido decidido.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['vigente', 'revisada', 'revogada', 'todas'] },
        tema: { type: 'string', enum: [...TEMAS_DECISAO] },
        texto: { type: 'string', description: 'Busca em título, decisão, contexto e motivo.' },
        para_revisar: { type: 'boolean', description: 'Só as vigentes com revisão vencida.' },
        limite: { type: 'integer', minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: 'registrar_decisao',
    description:
      'Grava uma decisão que o FERNANDO tomou nesta conversa, de forma explícita. Nunca registre sugestão sua como decisão. ' +
      'Inclua alternativas descartadas, motivo e uma data de revisão.',
    input_schema: {
      type: 'object',
      properties: {
        tema: { type: 'string', enum: [...TEMAS_DECISAO] },
        titulo: { type: 'string', maxLength: 140 },
        decisao: { type: 'string', description: 'O que passa a valer, em uma ou duas frases.' },
        contexto: { type: 'string' },
        alternativas: { type: 'string' },
        motivo: { type: 'string' },
        revisar_em: { type: 'string', description: 'AAAA-MM-DD' },
      },
      required: ['tema', 'titulo', 'decisao'],
    },
  },
  {
    name: 'registrar_reuniao',
    description:
      'Grava a ata da reunião (tipo manha ou tarde nas diárias) quando ela termina: o que foi olhado, o que foi decidido, ' +
      'pendências com dono e prazo. Registre quando o Fernando encerrar ou pedir.',
    input_schema: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: [...TIPOS_REUNIAO] },
        titulo: { type: 'string', maxLength: 140 },
        resumo: { type: 'string', description: 'A ata, curta, em texto corrido ou linhas com -.' },
        pauta: { type: 'string' },
        pendencias: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              descricao: { type: 'string' },
              dono: { type: 'string', description: 'Fernando, agente, ou o nome de quem faz.' },
              prazo: { type: 'string', description: 'AAAA-MM-DD' },
            },
            required: ['descricao'],
          },
        },
      },
      required: ['tipo', 'titulo', 'resumo'],
    },
  },
  {
    name: 'concluir_pendencia',
    description: 'Marca como feita a pendência aberta (das últimas atas) cuja descrição contém o trecho informado.',
    input_schema: {
      type: 'object',
      properties: { trecho: { type: 'string', minLength: 3, description: 'Parte da descrição da pendência.' } },
      required: ['trecho'],
    },
  },
  {
    name: 'gravar_placar',
    description: 'Tira a foto da semana (placar_semanal). Use na reunião de segunda ou quando o Fernando pedir; regravar substitui a foto da semana.',
    input_schema: { type: 'object', properties: { observacoes: { type: 'string' } } },
  },
  {
    name: 'funil_etapas',
    description:
      'Quantos pedidos do site estão em cada etapa (captado, pedido_completo, inativo, buscando_fornecedor, sem_fornecedor, ' +
      'em_negociacao, orcamento_atrasado, aguardando_pagamento, sem_resposta, orcamento_vencido, pago, em_producao, pronto, ' +
      'entregue, finalizado, encerrado, cancelado) com valor somado. A foto do funil.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'pedidos_por_etapa',
    description: 'Lista os pedidos numa ou mais etapas, do mais tempo parado pro mais recente: nome, telefone, valor, desde quando, última mensagem do cliente, motivo de parada.',
    input_schema: {
      type: 'object',
      properties: {
        etapas: { type: 'array', items: { type: 'string', enum: [...ETAPAS] }, minItems: 1, maxItems: 6 },
        limite: { type: 'integer', minimum: 1, maximum: 100 },
      },
      required: ['etapas'],
    },
  },
  {
    name: 'registrar_motivo_parada',
    description: 'Grava no pedido por que o cliente parou (esperando data, achou caro, não gostou do fornecedor…) sem encerrar. Referência = código, número ou id do pedido.',
    input_schema: {
      type: 'object',
      properties: { pedido: { type: 'string' }, motivo: { type: 'string', minLength: 3, maxLength: 500 } },
      required: ['pedido', 'motivo'],
    },
  },
  {
    name: 'encerrar_pedido',
    description:
      'Dá o pedido como perdido, com motivo (achou_caro, data, atendimento, sumiu, outro). SÓ depois de o Fernando confirmar ' +
      'explicitamente nesta conversa qual pedido e qual motivo. Pedido pago não se encerra. Dá pra reabrir no admin.',
    input_schema: {
      type: 'object',
      properties: {
        pedido: { type: 'string', description: 'Código (2026090…), número ou id.' },
        motivo: { type: 'string', enum: [...MOTIVOS_ENCERRAMENTO] },
        observacao: { type: 'string', maxLength: 500 },
      },
      required: ['pedido', 'motivo'],
    },
  },
  {
    name: 'buscar_contato',
    description:
      'Acha uma pessoa por parte do nome ou por telefone e devolve telefone, papel (cliente ou fornecedor), última mensagem, ' +
      'se o Luigi chamou gente e os pedidos dela. USE SEMPRE que o Fernando citar alguém pelo nome ("o André", "a Rafaella", ' +
      '"a JJ Camisetas") — nunca peça o telefone a ele antes de procurar aqui.',
    input_schema: {
      type: 'object',
      properties: {
        termo: { type: 'string', minLength: 2, description: 'Parte do nome ou o telefone.' },
        limite: { type: 'number', minimum: 1, maximum: 10 },
      },
      required: ['termo'],
    },
  },
  {
    name: 'ler_conversa',
    description:
      'As últimas mensagens trocadas com um número, em ordem, dizendo quem escreveu (contato, Luigi, assistente, equipe). ' +
      'Use antes de escrever pra alguém: assim você responde ao que já foi dito em vez de começar do zero.',
    input_schema: {
      type: 'object',
      properties: {
        telefone: { type: 'string', description: 'Com DDI e DDD.' },
        limite: { type: 'number', minimum: 1, maximum: 100, description: 'Padrão 30.' },
      },
      required: ['telefone'],
    },
  },
  {
    name: 'detalhe_pedido',
    description:
      'Abre um pedido por inteiro: cliente, etapa, valores, prazo, observações, as PEÇAS (modelo, tecido/material, cor, ' +
      'quantidade, numeradas por posição) e as ofertas de fornecedor. USE SEMPRE que o Fernando perguntar o que o cliente ' +
      'pediu, o que tem no pedido ou o que precisa ajustar — não responda "não sei o conteúdo" sem chamar isto antes.',
    input_schema: {
      type: 'object',
      properties: { pedido: { type: 'string', description: 'Código (2026090…), número ou id.' } },
      required: ['pedido'],
    },
  },
  {
    name: 'ajustar_peca_pedido',
    description:
      'Altera uma peça do pedido: tecido/material, modelo, cor, quantidade ou descrição. Informe só o que muda. A peça é ' +
      'identificada pela posição que aparece em detalhe_pedido (1 = primeira). Use quando o Fernando mandar ajustar algo ' +
      'que o cliente pediu. Pedido pago não altera. Se o orçamento já estava definido, ele volta pro fornecedor refazer e ' +
      'o fornecedor que aceitou é avisado — diga isso ao Fernando. Confirme o que entendeu antes de chamar.',
    input_schema: {
      type: 'object',
      properties: {
        pedido: { type: 'string', description: 'Código (2026090…), número ou id.' },
        posicao: { type: 'number', minimum: 1, maximum: 50, description: '1 = primeira peça (veja em detalhe_pedido).' },
        material: { type: 'string', maxLength: 200 },
        modelo: { type: 'string', maxLength: 120 },
        cor: { type: 'string', maxLength: 80 },
        quantidade: { type: 'number', minimum: 1, maximum: 100000 },
        descricao: { type: 'string', maxLength: 500 },
        confirmar: { type: 'boolean', description: 'Precisa ser true — o Fernando confirmou a mudança.' },
      },
      required: ['pedido', 'posicao', 'confirmar'],
    },
  },
  {
    name: 'captar_para_pedido',
    description:
      'Sai atrás de confecções pra um pedido que está sem fornecedor: busca candidatas na região, registra e prepara a ' +
      'sondagem. É o que destrava a etapa sem_fornecedor. Região: uf (estado do cliente), pe (polo de Pernambuco) ou ' +
      'brasil — na dúvida, uf. Exige confirmar=true porque abre contato com empresas de fora da base.',
    input_schema: {
      type: 'object',
      properties: {
        pedido: { type: 'string', description: 'Código (2026090…), número ou id.' },
        regiao: { type: 'string', enum: ['uf', 'pe', 'brasil'] },
        confirmar: { type: 'boolean', description: 'Precisa ser true — o Fernando mandou buscar.' },
      },
      required: ['pedido', 'confirmar'],
    },
  },
  {
    name: 'corrigir_orcamento',
    description:
      'Corrige valor, frete e repasse de um pedido, com motivo, e grava versão no histórico. Valores em CENTAVOS. ' +
      'O repasse não pode passar do valor. Pedido pago não muda de valor. SÓ depois de o Fernando confirmar os números ' +
      'nesta conversa. Não existe "mover etapa": ao definir o orçamento o pedido anda sozinho pra aguardando pagamento.',
    input_schema: {
      type: 'object',
      properties: {
        pedido: { type: 'string', description: 'Código (2026090…), número ou id.' },
        valor_centavos: { type: 'number', minimum: 0 },
        frete_centavos: { type: 'number', minimum: 0 },
        repasse_centavos: { type: 'number', minimum: 0 },
        motivo: { type: 'string', maxLength: 500 },
      },
      required: ['pedido', 'valor_centavos', 'frete_centavos', 'repasse_centavos', 'motivo'],
    },
  },
  {
    name: 'reabrir_pedido',
    description: 'Desfaz o encerramento de um pedido: ele volta a ser calculado pela etapa real. Use quando o cliente voltou ou foi engano.',
    input_schema: {
      type: 'object',
      properties: { pedido: { type: 'string', description: 'Código, número ou id.' } },
      required: ['pedido'],
    },
  },
  {
    name: 'preparar_mensagem',
    description:
      'Escreve uma mensagem pra um cliente ou fornecedor e devolve rascunho_id. NÃO ENVIA. Mostre ao Fernando o texto ' +
      'exatamente como voltou e só chame enviar_rascunho depois do "pode mandar" dele. Vale 30 min. Fora da janela de ' +
      '24 h é preciso template aprovado. Não serve pro número do próprio Fernando.',
    input_schema: {
      type: 'object',
      properties: {
        telefone: { type: 'string', description: 'Com DDI e DDD, ex.: 5581998496055.' },
        texto: { type: 'string', maxLength: 4000 },
        nome: { type: 'string', maxLength: 120 },
        template_nome: { type: 'string', maxLength: 512 },
        template_variaveis: {
          type: 'array',
          items: { type: 'string', maxLength: 200 },
          maxItems: 10,
          description:
            'Valores de {{1}}, {{2}}… na ordem. OBRIGATÓRIO quando o corpo do template tem variável — veja o corpo em ' +
            'templates_whatsapp. Em quase todos, {{1}} é o primeiro nome de quem recebe (ex.: ["Nicole"]).',
        },
        pedido_id: { type: 'string', description: 'Código (2026090…) ou id do pedido.' },
        contexto: { type: 'string', maxLength: 500 },
      },
      required: ['telefone', 'texto'],
    },
  },
  {
    name: 'enviar_rascunho',
    description:
      'Manda o rascunho criado por preparar_mensagem — sai exatamente o texto gravado. Efeito externo e irreversível: ' +
      'só depois de o Fernando ler o texto e aprovar. Envia uma vez só.',
    input_schema: {
      type: 'object',
      properties: { rascunho_id: { type: 'string' } },
      required: ['rascunho_id'],
    },
  },
]

type Entrada = Record<string, unknown>

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

async function executarFerramenta(nome: string, entrada: Entrada): Promise<unknown> {
  switch (nome) {
    case 'resumo_gestao':
      return await resumoGestao()
    case 'fila_cobranca': {
      const fila = await filaCobranca()
      return fila.slice(0, 40).map((i) => ({ ...i, valor: reais(i.valor_centavos) }))
    }
    case 'conversas_sem_resposta':
      return (await conversasSemResposta(num(entrada.horas) ?? 2)).slice(0, 40)
    case 'pedidos_sem_fornecedor':
      return (await pedidosSemFornecedor(num(entrada.horas) ?? 24)).slice(0, 40).map((p) => ({ ...p, valor: reais(p.valor_centavos) }))
    case 'buscar_decisoes': {
      const status = str(entrada.status) as 'vigente' | 'revisada' | 'revogada' | 'todas' | undefined
      return await listarDecisoes({
        status: status ?? 'vigente',
        tema: str(entrada.tema),
        texto: str(entrada.texto),
        paraRevisar: entrada.para_revisar === true,
        limite: num(entrada.limite) ?? 20,
      })
    }
    case 'registrar_decisao': {
      const tema = str(entrada.tema)
      const titulo = str(entrada.titulo)
      const decisao = str(entrada.decisao)
      if (!tema || !titulo || !decisao) throw new Error('tema, titulo e decisao são obrigatórios')
      const d = await registrarDecisao({
        tema,
        titulo,
        decisao,
        contexto: str(entrada.contexto) ?? null,
        alternativas: str(entrada.alternativas) ?? null,
        motivo: str(entrada.motivo) ?? null,
        revisar_em: str(entrada.revisar_em) ?? null,
        documento: 'claude/sistema-operacional-escala.md',
        origem: 'whatsapp',
      })
      return { numero: `D-${d.numero}`, id: d.id, titulo: d.titulo, revisar_em: d.revisar_em }
    }
    case 'registrar_reuniao': {
      const tipo = str(entrada.tipo) as TipoReuniao | undefined
      const titulo = str(entrada.titulo)
      const resumo = str(entrada.resumo)
      if (!tipo || !TIPOS_REUNIAO.includes(tipo) || !titulo || !resumo) throw new Error('tipo, titulo e resumo são obrigatórios')
      const pend = Array.isArray(entrada.pendencias) ? (entrada.pendencias as Pendencia[]) : []
      const r = await registrarReuniao({ tipo, titulo, resumo, pauta: str(entrada.pauta) ?? null, pendencias: pend, origem: 'whatsapp' })
      return { id: r.id, tipo: r.tipo, titulo: r.titulo, pendencias: r.pendencias.length }
    }
    case 'concluir_pendencia': {
      const trecho = str(entrada.trecho)
      if (!trecho) throw new Error('trecho é obrigatório')
      const feitas = await concluirPendencia(trecho)
      return feitas.length ? feitas : { aviso: 'Nenhuma pendência aberta contém esse trecho.' }
    }
    case 'gravar_placar': {
      const p = await gravarPlacar('whatsapp', str(entrada.observacoes) ?? null)
      return { id: p.id, semana_inicio: p.semana_inicio, gerado_em: p.gerado_em }
    }
    case 'funil_etapas':
      return (await contagemPorEtapa()).map((f) => ({ ...f, label: INFO_ETAPA[f.etapa].label, valor: reais(f.valor_centavos) }))
    case 'pedidos_por_etapa': {
      const etapas = (Array.isArray(entrada.etapas) ? entrada.etapas : []).filter((e): e is Etapa => (ETAPAS as readonly string[]).includes(String(e)))
      if (etapas.length === 0) throw new Error('informe ao menos uma etapa válida')
      const lista = await pedidosPorEtapa(etapas, num(entrada.limite) ?? 30)
      return lista.map((p) => ({
        codigo: p.codigo,
        nome: p.nome,
        telefone: p.telefone,
        uf: p.uf,
        etapa: p.etapa,
        desde: p.desde,
        valor: p.valor_centavos != null ? reais(p.valor_centavos) : null,
        ultimo_contato_cliente_em: p.ultimo_contato_cliente_em,
        motivo_parada: p.motivo_parada,
        ofertas_no_ar: p.ofertas_no_ar,
        ofertas_recusadas: p.ofertas_recusadas,
      }))
    }
    case 'registrar_motivo_parada': {
      const ref = str(entrada.pedido)
      const motivo = str(entrada.motivo)
      if (!ref || !motivo) throw new Error('pedido e motivo são obrigatórios')
      const p = await acharPedido(ref)
      if (!p) throw new Error(`pedido "${ref}" não encontrado`)
      const r = await registrarMotivoParada(p.id, motivo)
      return { codigo: r.codigo, nome: r.nome, etapa: r.etapa, motivo_parada: r.motivo_parada }
    }
    case 'encerrar_pedido': {
      const ref = str(entrada.pedido)
      const motivo = str(entrada.motivo) as MotivoEncerramento | undefined
      if (!ref || !motivo || !(MOTIVOS_ENCERRAMENTO as readonly string[]).includes(motivo)) throw new Error('pedido e motivo válido são obrigatórios')
      const p = await acharPedido(ref)
      if (!p) throw new Error(`pedido "${ref}" não encontrado`)
      const r = await encerrarPedido(p.id, motivo, 'gestor_whatsapp', str(entrada.observacao) ?? null)
      return { codigo: r.codigo, nome: r.nome, etapa: r.etapa, encerrado_motivo: r.encerrado_motivo }
    }
    case 'buscar_contato': {
      const termo = str(entrada.termo)
      if (!termo) throw new Error('termo é obrigatório')
      const achados = await buscarContato(termo, num(entrada.limite) ?? 5)
      return achados.length > 0 ? achados : { aviso: `ninguém encontrado com "${termo}"` }
    }
    case 'ler_conversa': {
      const telefone = str(entrada.telefone)
      if (!telefone) throw new Error('telefone é obrigatório')
      return await lerConversa(telefone, num(entrada.limite) ?? 30)
    }
    case 'detalhe_pedido': {
      const ref = str(entrada.pedido)
      if (!ref) throw new Error('pedido é obrigatório')
      const p = await acharPedido(ref)
      if (!p) throw new Error(`pedido "${ref}" não encontrado`)
      return (await detalhePedido(p.id)) ?? { aviso: 'pedido sem detalhe' }
    }
    case 'ajustar_peca_pedido': {
      const ref = str(entrada.pedido)
      const posicao = num(entrada.posicao)
      if (!ref || !posicao) throw new Error('pedido e posicao são obrigatórios')
      if (entrada.confirmar !== true) throw new Error('ajuste não confirmado: confirme com o Fernando e chame de novo com confirmar=true')
      const p = await acharPedido(ref)
      if (!p) throw new Error(`pedido "${ref}" não encontrado`)

      const { data: ped } = await supabaseAdmin
        .from('pedidos_assistente')
        .select('linhas')
        .eq('id', p.id)
        .maybeSingle<{ linhas: LinhaPedido[] | null }>()
      const atuais: LinhaPedido[] = Array.isArray(ped?.linhas) ? ped.linhas : []
      if (posicao > atuais.length) throw new Error(`o pedido tem ${atuais.length} peça(s); não existe a ${posicao}ª`)

      const linhas = atuais.map((l, i) =>
        i === posicao - 1
          ? {
              ...l,
              origIdx: i,
              material: str(entrada.material) ?? l.material,
              modelo: str(entrada.modelo) ?? l.modelo,
              cor: str(entrada.cor) ?? l.cor,
              total: num(entrada.quantidade) ?? l.total,
              descricao: str(entrada.descricao) ?? l.descricao,
            }
          : { ...l, origIdx: i }
      )
      const r = await editarLinhasPedidoCliente({ pedidoId: p.id, linhas })
      if (!r.ok) throw new Error(r.erro)
      return { codigo: p.codigo, mudou: r.mudou, resumo: r.resumo, orcamento_reaberto: r.orcamentoReaberto }
    }
    case 'captar_para_pedido': {
      const ref = str(entrada.pedido)
      if (!ref) throw new Error('pedido é obrigatório')
      if (entrada.confirmar !== true) throw new Error('captação não confirmada: confirme com o Fernando e chame de novo com confirmar=true')
      const p = await acharPedido(ref)
      if (!p) throw new Error(`pedido "${ref}" não encontrado`)
      const regiao = REGIOES.includes(str(entrada.regiao) as RegiaoBusca) ? (str(entrada.regiao) as RegiaoBusca) : undefined
      // origem 'mcp' = pedida por agente (aqui, o de gestão no WhatsApp), pra
      // separar no log do que sai do cron e do que sai do admin na mão.
      const r = await captarParaPedido(p, { origem: 'mcp', regiao, forcar: true })
      if (r.erro) throw new Error(r.erro)
      return { codigo: p.codigo, etapa: p.etapa, resultado: r }
    }
    case 'corrigir_orcamento': {
      const ref = str(entrada.pedido)
      const valor = num(entrada.valor_centavos)
      const frete = num(entrada.frete_centavos)
      const repasse = num(entrada.repasse_centavos)
      const motivo = str(entrada.motivo)
      if (!ref || valor === undefined || frete === undefined || repasse === undefined || !motivo) {
        throw new Error('pedido, valor_centavos, frete_centavos, repasse_centavos e motivo são obrigatórios')
      }
      const p = await acharPedido(ref)
      if (!p) throw new Error(`pedido "${ref}" não encontrado`)
      const r = await corrigirOrcamento({
        pedidoId: p.id,
        valorCentavos: valor,
        freteCentavos: frete,
        repasseCentavos: repasse,
        motivo,
        autorNome: 'Agente de gestão (WhatsApp)',
      })
      if (!r.ok) throw new Error(r.erro)
      const depois = await acharPedido(p.id)
      return { codigo: p.codigo, nome: p.nome, valor_centavos: r.valorCentavos, etapa_antes: p.etapa, etapa_agora: depois?.etapa ?? p.etapa }
    }
    case 'reabrir_pedido': {
      const ref = str(entrada.pedido)
      if (!ref) throw new Error('pedido é obrigatório')
      const p = await acharPedido(ref)
      if (!p) throw new Error(`pedido "${ref}" não encontrado`)
      if (!p.encerrado_motivo) throw new Error(`o pedido ${p.codigo ?? ref} não está encerrado (etapa: ${p.etapa})`)
      const r = await reabrirPedidoEncerrado(p.id)
      return { codigo: r.codigo, nome: r.nome, etapa_antes: p.etapa, etapa_agora: r.etapa }
    }
    case 'preparar_mensagem': {
      const telefone = str(entrada.telefone)
      const texto = str(entrada.texto)
      if (!telefone || !texto) throw new Error('telefone e texto são obrigatórios')
      const variaveis = Array.isArray(entrada.template_variaveis)
        ? (entrada.template_variaveis as unknown[]).map((v) => String(v ?? '').trim()).filter(Boolean)
        : undefined
      const r = await prepararMensagem({
        telefone,
        texto,
        nome: str(entrada.nome) ?? null,
        templateNome: str(entrada.template_nome) ?? null,
        templateVariaveis: variaveis,
        pedidoId: str(entrada.pedido_id) ?? null,
        contexto: str(entrada.contexto) ?? null,
      })
      if (!r.ok) throw new Error(r.erro)
      return {
        rascunho_id: r.rascunho.id,
        para: r.rascunho.waId,
        janela_24h: r.rascunho.janelaAberta ? 'aberta' : 'fechada',
        texto_que_sera_enviado: r.rascunho.texto,
        aviso: r.aviso,
        proximo_passo: 'Mostre o texto ao Fernando e só envie com o "pode mandar" dele.',
      }
    }
    case 'enviar_rascunho': {
      const id = str(entrada.rascunho_id)
      if (!id) throw new Error('rascunho_id é obrigatório')
      const r = await enviarRascunho(id)
      if (!r.ok) throw new Error(r.erro)
      return { enviado: true, para: r.waId, wamid: r.wamid }
    }
    default:
      throw new Error(`ferramenta desconhecida: ${nome}`)
  }
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

function promptSistema(): string {
  return `Você é o agente de gestão da Confeccione, marketplace B2B de confecção de roupas (Recife, PE) que conecta clientes a fornecedores. Está falando pelo WhatsApp com o Fernando, fundador da empresa. Agora em Recife: ${agoraRecife()}.

RITUAL (decisão D-7): duas reuniões por dia por esta conversa. 07:00 — fila do dia e as 3 prioridades. 17:30 — o que saiu, o que travou, decisões e ata. Fora desses horários ele também pode te chamar pra qualquer assunto da empresa. A reunião de segunda 07:00 é a do placar semanal (grave a foto com gravar_placar).

FONTE DE VERDADE: o diário de bordo, pelas ferramentas. Nunca invente número — se não consultou, consulte. Na primeira mensagem de uma reunião chame resumo_gestao. Se a sua última mensagem foi só o aviso de que a pauta está pronta, a primeira resposta é a pauta completa. Consulte buscar_decisoes antes de propor algo que pode já ter sido decidido.

SUA MEMÓRIA TEM DUAS PARTES, E VOCÊ PRECISA DAS DUAS. A conversa aqui te dá os últimos dias. Tudo que é mais antigo que isso mora no diário de bordo, e só chega até você se VOCÊ buscar. Quando o Fernando citar algo combinado antes ("a régua", "aquilo que a gente decidiu", "o que ficou de ontem") e você não achar na conversa, chame buscar_decisoes e buscar_reunioes ANTES de dizer que não lembra. "Não tenho memória disso" é a última resposta possível, depois de ter procurado — nunca a primeira.

E O QUE VOCÊ APRENDER, GRAVE. Decisão que o Fernando toma nesta conversa e que vai valer amanhã (mudança de regra, prioridade, preço, política de atendimento) some quando a conversa rolar pra fora da janela, a não ser que você chame registrar_decisao na hora. Não pergunte "quer que eu registre?" a cada frase: registre o que muda o funcionamento da empresa, e diga em uma linha que registrou. O que ele decidiu e você não gravou, ele vai ter que decidir de novo.

O QUE VOCÊ PODE: ler placar, filas, funil por etapa, decisões e atas; registrar decisão, ata, pendência concluída, foto do placar, motivo de parada de um pedido; ENCERRAR um pedido como perdido e REABRIR um encerrado; CORRIGIR o orçamento de um pedido (valor, frete e repasse, em centavos, com motivo — pedido pago não muda de valor); e FALAR COM CLIENTE OU FORNECEDOR, em duas etapas.

UMA PESSOA, UMA MENSAGEM: antes de disparar pra uma lista, agrupe por TELEFONE, não por pedido. Cliente com vários pedidos incompletos criados quase junto duplicou sem querer no site — mandar uma mensagem por pedido faz a gente parecer que não olha a própria base. Mande uma só, e nela pergunte se ele quer seguir com todos ou se foi duplicação. Também tire da lista quem já falou com a gente hoje e quem tem telefone inválido (brasileiro é 55 + DDD de 2 dígitos + 8 ou 9 dígitos; 12 ou 14 no total não existe).

A EMPRESA, PRA QUANDO VOCÊ ESCREVER: Confeccione, marketplace B2B de confecção, empresa de Recife embarcada no Porto Digital desde 28/05/2026, CNPJ 49.307.439/0001-50, página confeccione.com.br/porto-digital. Use quando preparar mensagem pra quem pode desconfiar de abordagem por WhatsApp — cliente novo ou confecção que a gente nunca contatou. Só o que está aqui: nada de prêmio, investidor ou número de clientes inventado.

PROCURE ANTES DE PERGUNTAR: quando o Fernando citar alguém pelo nome ("responde o André", "e a Rafaella?", "a JJ Camisetas"), chame buscar_contato — você acha o telefone, o papel, os pedidos e a última mensagem sozinho. Quando ele falar de um pedido, chame detalhe_pedido pra ver as peças. Antes de escrever pra alguém, chame ler_conversa. NUNCA responda "não tenho ferramenta pra isso", "não sei o conteúdo" ou peça a ele um dado que você consegue buscar: primeiro procure com as ferramentas, e só diga que não achou depois de ter procurado de verdade. Não peça permissão pra consultar — leitura não precisa de confirmação, faça e traga o resultado.

NOME, TELEFONE, CÓDIGO E NÚMERO SÓ SAEM DE FERRAMENTA: se você vai escrever um nome de cliente, um telefone, um código de pedido, um valor ou uma contagem ("são 60 pedidos"), esse dado precisa ter voltado de uma ferramenta NESTA conversa. Não existe estimativa, não existe exemplo ilustrativo, não existe "algo como". Se você ainda não chamou a ferramenta, chame agora; se chamou e não veio, diga que não veio. Uma lista inventada é pior do que nenhuma lista: o Fernando toma decisão em cima dela, manda mensagem pra gente que não existe, e quando descobre não sabe mais o que da sua resposta era real. Você não tem como saber de cabeça quem está parado no funil — isso muda toda hora e mora no banco, não em você.

E NÃO DIGA QUE NÃO TEM O QUE VOCÊ TEM: pedidos_por_etapa devolve a lista real com nome, telefone e código, até 200 por chamada. O que você não tem é DISPARO EM LOTE — cada mensagem é um preparar_mensagem e um enviar_rascunho, e por isso mandar pra dezenas de pessoas numa conversa não cabe. Essas duas coisas são diferentes: a primeira você faz, a segunda é da régua automática, não sua.

JANELA FECHADA = CHAME templates_whatsapp: se preparar_mensagem disser que a janela de 24 h está fechada, chame templates_whatsapp, escolha um APROVADO que sirva e prepare de novo com template_nome. Escolha pelo DESTINATÁRIO, não pelo nome do template: pra CLIENTE com pedido em aberto use duvida_pedido_manha, duvida_pedido_tarde ou duvida_pedido_noite conforme a hora aqui (manhã até 11:59, tarde até 17:59, noite depois) — falam do pedido dele. sondagem_producao e luigi_apresentacao são pra abordar CONFECÇÃO ("uma produção com vocês") e soam errados pra cliente. retomar_pedido_v3 leva o cliente de volta ao site; use quando a intenção for que ele preencha lá, não quando você quiser conversar aqui. Nunca peça ao Fernando o nome do template, nunca peça pra ele abrir painel da Meta, e nunca cite Z-API — ela foi desligada na D-1 e não existe mais no sistema. Se um template que você tentou não estiver na lista, é porque não existe: escolha outro da lista, não invente.

QUANDO UMA FERRAMENTA FALHAR: leia a mensagem de erro e resolva o que ela diz. Não liste hipóteses pro Fernando nem devolva o problema pra ele antes de tentar. Se o erro citar um campo, corrija aquele campo e chame de novo. Só o traga quando você já tiver tentado e a mensagem disser algo que só ele pode resolver.

QUANDO O DADO NÃO BATER: se o que o Fernando te passa não casa com o que você acha (um telefone que não existe no sistema, um código que não é daquela pessoa), diga isso na hora e mostre o que VOCÊ achou, com nome e número. Ele digita de memória e erra; seu papel é cruzar, não aceitar. Um telefone brasileiro tem DDI 55 + DDD de 2 dígitos + 8 ou 9 dígitos — DDD diferente é quase sempre outra pessoa.

FALAR COM CLIENTE OU FORNECEDOR (duas etapas, sempre): primeiro preparar_mensagem, que só escreve e devolve um rascunho_id — não sai nada. Mostre a ele o texto exatamente como voltou, em bloco, e pergunte se pode mandar. Só com o "pode mandar" dele, chame enviar_rascunho com aquele id. Se ele pedir mudança, prepare um rascunho novo: o texto gravado não se altera. Rascunho vale 30 min. Nunca chame enviar_rascunho na mesma resposta em que preparou.

COMO ESCREVER PRO CLIENTE: conversa, não comunicado. Frases curtas, 1 a 3 linhas, uma ideia e uma pergunta por mensagem, e pare pra esperar a resposta. Pergunte bastante — pra que é a peça, pra quando, quantas pessoas — uma por vez. Sem emoji. Nunca invente que estava almoçando, com fome, com frio ou qualquer coisa que dependa de ter corpo; "desculpa a demora" basta.

DESTRAVAR PEDIDO SEM FORNECEDOR: use captar_para_pedido quando um pedido estiver em sem_fornecedor e o Fernando mandar buscar. Ele procura confecções na região e prepara a sondagem — é o caminho pra tirar pedido da fila parada. Diga quantas candidatas apareceram.

AÇÃO COM EFEITO EXTERNO SÓ COM CONFIRMAÇÃO: encerrar pedido, corrigir orçamento, captar fornecedor e enviar rascunho mexem no mundo real. Confirme em uma linha (qual pedido, quais números, qual texto) e só então execute. O QUE VOCÊ CONTINUA SEM PODER: cobrar, mover dinheiro, mexer em código ou dar deploy — isso é com o Fernando ou com o Cowork (Claude no computador).

LUIGI: o agente de atendimento responde os clientes no WhatsApp oficial sozinho (modo escolhido no topo do inbox: desligado, sugere, responde). Quando ele chama gente (preço, reclamação, fora do pedido), a conversa aparece em conversas_sem_resposta com luigi_chamou=true e o Fernando recebe "Luigi chamou você: …" nesta conversa. Quem responde ao cliente é o Fernando, pelo inbox — você só aponta.

ETAPAS DO PEDIDO (D-8, calculadas no banco): captado (contato sem peça completa) → pedido_completo (não clicou em Buscar fornecedor) → buscando_fornecedor → sem_fornecedor (24 h, alerta) → em_negociacao (aos 3 dias, perguntar ao cliente se a conversa deu certo) → orcamento_atrasado (7 dias, alerta) → aguardando_pagamento → sem_resposta (3 dias, alerta) → orcamento_vencido (21 dias) → pago → em_producao → pronto → entregue → finalizado; inativo (30 dias sem toque); encerrado (perdido, com motivo) e cancelado. Use funil_etapas pra foto e pedidos_por_etapa pra nomes.

REGISTRO: só grave decisão quando o Fernando decidir de forma explícita ("vamos fazer X", "decidido", "fica assim"); se houver dúvida, confirme em uma linha antes. No fim da reunião (ele diz "fechamos", "é isso", "pode registrar" ou pede a ata) grave a ata com registrar_reuniao (tipo manha ou tarde conforme a hora; sessao fora delas) com resumo curto e pendências com dono e prazo, e marque com concluir_pendencia o que ele disser que fez.

DECISÕES VIGENTES (detalhes em buscar_decisoes): D-1 WhatsApp só pela API oficial da Meta (Z-API desligada). D-2 sem SaaS de IA por cima do sistema: controle próprio, placar semanal, agentes por função com nível de autonomia. D-3 e-mail no motor próprio via Resend. D-4 MCP no lugar de iPaaS. D-5 memória de gestão no Supabase (placar, decisões, atas). D-6 mensagens de recuperação e cobrança no WhatsApp curtas, sem emoji, sem botão, pelo agente Luigi. D-7 esta reunião, 2x por dia. D-8 etapa única do pedido calculada no banco, prazos 24 h / 3 d / 21 d / 30 d, encerrar só com motivo e por decisão dele. D-9 orçamento atrasado só após 7 dias; aos 3 dias pergunta-se ao cliente se a conversa com o fornecedor deu certo.

ESTILO: WhatsApp. Curto — de 2 a 8 linhas na maior parte das vezes; a pauta pode ter até 12. Português direto, sem preâmbulo, sem elogio, sem emoji. Sem markdown: nada de #, tabelas ou **; no máximo *negrito* em um número importante e linhas começando com "-". Valores em reais no formato brasileiro (R$ 1.234,56). Uma pergunta por vez. Quando não souber, diga. Quando a resposta for uma lista de pessoas ou pedidos, traga nome, valor e há quanto tempo. Termine a pauta com a pergunta do que ele quer atacar primeiro.`
}

// ─── Histórico da conversa ──────────────────────────────────────────────────

type LinhaMensagem = {
  wamid: string | null
  direcao: string
  tipo: string
  corpo: string | null
  template_nome: string | null
  criado_em: string
  /** Caminho no bucket wa-midia — é por ele que a imagem chega ao modelo. */
  midia_path: string | null
  midia_mime: string | null
}

function textoDaLinha(m: LinhaMensagem): string {
  if (m.corpo && m.corpo.trim()) return m.corpo.trim()
  switch (m.tipo) {
    case 'audio':
      return '[áudio]'
    case 'image':
      return '[imagem]'
    case 'document':
      return '[documento]'
    default:
      return `[${m.tipo}]`
  }
}

/**
 * Quantas imagens do histórico o agente enxerga de verdade.
 *
 * Cada imagem custa tokens de entrada e o Fernando manda print com frequência
 * (foi assim que ele mostrou a lista de templates em 09/09/2026). Carregar
 * todas de uma conversa longa encareceria cada turno sem ganho: o que importa
 * é o que ele acabou de mandar. As mais antigas continuam como "[imagem]".
 */
const IMAGENS_NO_HISTORICO = 3
const MIMES_VISAO = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const

type BlocoImagem = { type: 'image'; source: { type: 'base64'; media_type: (typeof MIMES_VISAO)[number]; data: string } }

/** Baixa a imagem do Storage e devolve o bloco pro modelo. Falha vira null. */
async function blocoDaImagem(path: string, mime: string | null): Promise<BlocoImagem | null> {
  const media_type = (MIMES_VISAO as readonly string[]).includes(mime ?? '')
    ? (mime as (typeof MIMES_VISAO)[number])
    : 'image/jpeg'
  try {
    const { data, error } = await supabaseAdmin.storage.from('wa-midia').download(path)
    if (error || !data) return null
    const buffer = Buffer.from(await data.arrayBuffer())
    // Acima disto o custo por turno deixa de compensar; o print de tela do
    // Fernando fica bem abaixo desse teto.
    if (buffer.byteLength > 4 * 1024 * 1024) return null
    return { type: 'image', source: { type: 'base64', media_type, data: buffer.toString('base64') } }
  } catch {
    return null
  }
}

async function historicoConversa(conversaId: string): Promise<{ msgs: Anthropic.Messages.MessageParam[]; wamids: Set<string> }> {
  const { data } = await supabaseAdmin
    .from('wa_mensagens')
    .select('wamid, direcao, tipo, corpo, template_nome, criado_em, midia_path, midia_mime')
    .eq('conversa_id', conversaId)
    .order('criado_em', { ascending: false })
    .limit(HISTORICO_MENSAGENS)

  const linhas = ((data ?? []) as LinhaMensagem[]).reverse()
  const wamids = new Set(linhas.map((m) => m.wamid).filter((w): w is string => Boolean(w)))

  // Só as últimas N imagens que ELE mandou entram como visão.
  const comImagem = linhas.filter((m) => m.direcao === 'entrada' && m.tipo === 'image' && m.midia_path)
  const carregar = new Set(comImagem.slice(-IMAGENS_NO_HISTORICO).map((m) => m.midia_path as string))
  const blocos = new Map<string, BlocoImagem>()
  await Promise.all(
    [...carregar].map(async (path) => {
      const b = await blocoDaImagem(path, comImagem.find((m) => m.midia_path === path)?.midia_mime ?? null)
      if (b) blocos.set(path, b)
    })
  )

  const msgs: Anthropic.Messages.MessageParam[] = []
  for (const m of linhas) {
    const role: 'user' | 'assistant' = m.direcao === 'entrada' ? 'user' : 'assistant'
    const bloco = m.midia_path ? blocos.get(m.midia_path) : undefined
    const texto = bloco ? (m.corpo?.trim() || 'Olha esta imagem.') : textoDaLinha(m)

    // Com imagem o conteúdo vira lista de blocos e não dá pra concatenar como
    // texto — por isso a mensagem com imagem sempre abre um turno próprio.
    if (bloco) {
      msgs.push({ role, content: [bloco, { type: 'text', text: texto }] })
      continue
    }

    const anterior = msgs[msgs.length - 1]
    if (anterior && anterior.role === role && typeof anterior.content === 'string') {
      anterior.content = `${anterior.content}\n\n${texto}`
    } else {
      msgs.push({ role, content: texto })
    }
  }
  // A API exige começar com o usuário; se a conversa abre com a pauta (nossa),
  // um marcador vazio no lugar dele preserva o contexto em vez de descartá-lo.
  if (msgs.length && msgs[0].role !== 'user') msgs.unshift({ role: 'user', content: '[início da conversa]' })
  return { msgs, wamids }
}

// ─── O loop do agente ───────────────────────────────────────────────────────

type ChamadaFerramenta = { nome: string; argumentos: Entrada; ok: boolean; erro?: string }

type ResultadoAgente = {
  texto: string
  ferramentas: ChamadaFerramenta[]
  rodadas: number
  tokensEntrada: number
  tokensSaida: number
}

function textoDaResposta(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()
}

async function rodarAgente(mensagens: Anthropic.Messages.MessageParam[], rota: string): Promise<ResultadoAgente> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY ausente')
  const client = new Anthropic({ apiKey })

  const historico: Anthropic.Messages.MessageParam[] = [...mensagens]
  const ferramentas: ChamadaFerramenta[] = []
  let tokensEntrada = 0
  let tokensSaida = 0
  let rodadas = 0
  let texto = ''
  let concluiu = false
  const limite = Date.now() + ORCAMENTO_MS

  while (rodadas < MAX_RODADAS && Date.now() < limite) {
    rodadas++
    const resposta = await client.messages.create({
      model: MODELO,
      max_tokens: MAX_TOKENS_RESPOSTA,
      system: promptSistema(),
      tools: FERRAMENTAS,
      messages: historico,
    })
    void registrarUsoIa(rota, MODELO, resposta.usage)
    tokensEntrada += resposta.usage?.input_tokens ?? 0
    tokensSaida += resposta.usage?.output_tokens ?? 0

    const usos = resposta.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use')
    const parcial = textoDaResposta(resposta.content)
    if (parcial) texto = parcial

    if (resposta.stop_reason !== 'tool_use' || usos.length === 0) {
      concluiu = true
      break
    }

    historico.push({ role: 'assistant', content: resposta.content })
    const resultados: Anthropic.Messages.ToolResultBlockParam[] = []
    for (const uso of usos) {
      const entrada = (uso.input ?? {}) as Entrada
      try {
        const saida = await executarFerramenta(uso.name, entrada)
        ferramentas.push({ nome: uso.name, argumentos: entrada, ok: true })
        resultados.push({ type: 'tool_result', tool_use_id: uso.id, content: JSON.stringify(saida).slice(0, 60_000) })
      } catch (err) {
        const erro = err instanceof Error ? err.message : String(err)
        ferramentas.push({ nome: uso.name, argumentos: entrada, ok: false, erro })
        resultados.push({ type: 'tool_result', tool_use_id: uso.id, content: `Erro: ${erro}`, is_error: true })
      }
    }
    historico.push({ role: 'user', content: resultados })
  }

  if (!texto) texto = 'Não consegui fechar uma resposta agora. Pode repetir de outro jeito?'

  // Sem isto, estourar o limite mandava o último texto parcial — em geral um
  // "um segundo" — e encerrava calado: o Fernando ficava esperando uma resposta
  // que nunca vinha (09/09/2026). Dizer que parou no meio é o mínimo; ele
  // decide se quebra o pedido em partes.
  if (!concluiu) {
    texto = `${texto}\n\n(Parei no meio: o pedido tem passos demais pra uma resposta só. Me diz por qual começar que eu sigo.)`
  }

  return { texto: paraWhatsApp(texto), ferramentas, rodadas, tokensEntrada, tokensSaida }
}

// ─── Log ────────────────────────────────────────────────────────────────────

type Log = {
  conversa_id: string | null
  wa_id: string
  wamid_entrada: string | null
  origem: 'resposta' | 'pauta'
  mensagem: string | null
  resposta: string | null
  ferramentas: ChamadaFerramenta[]
  modelo: string
  rodadas: number
  tokens_entrada: number
  tokens_saida: number
  duracao_ms: number
  enviado: boolean
  erro: string | null
}

async function gravarLog(l: Log): Promise<void> {
  try {
    await supabaseAdmin.from('gestao_whatsapp_log').insert(l)
  } catch (err) {
    console.error('[gestao-wa] log falhou', { err })
  }
}

// ─── Resposta a uma mensagem do gestor ──────────────────────────────────────

export async function responderGestao(params: {
  conversaId: string
  waId: string
  nome: string | null
  wamid: string
  /** criado_em gravado no inbox (timestamp da Meta, resolução de segundo). */
  criadoEm: string
  tipo: string
  corpo: string | null
}): Promise<void> {
  const inicio = Date.now()
  const waId = normalizarWaId(params.waId)
  if (!ehNumeroGestao(waId)) return

  const base: Omit<Log, 'resposta' | 'ferramentas' | 'rodadas' | 'tokens_entrada' | 'tokens_saida' | 'duracao_ms' | 'enviado' | 'erro'> = {
    conversa_id: params.conversaId,
    wa_id: waId,
    wamid_entrada: params.wamid,
    origem: 'resposta',
    mensagem: params.corpo,
    modelo: MODELO,
  }

  // Imagem o agente lê (o histórico monta o bloco de visão); áudio ainda não,
  // porque exigiria transcrição. Print sem legenda é caso comum: o Fernando
  // manda a tela e espera que ele olhe.
  const temTexto = Boolean(params.corpo && params.corpo.trim())
  if (!temTexto && params.tipo !== 'image') {
    const aviso = 'Áudio eu ainda não escuto. Me manda escrito ou por print?'
    const r = await enviarTexto(waId, aviso)
    if (r.ok) await registrarSaidaInbox(waId, params.nome, r.wamid, aviso, null, 'gestao')
    await gravarLog({ ...base, resposta: aviso, ferramentas: [], rodadas: 0, tokens_entrada: 0, tokens_saida: 0, duracao_ms: Date.now() - inicio, enviado: r.ok, erro: r.ok ? null : r.erro })
    return
  }

  // Se ele mandou duas mensagens seguidas, quem responde é a última invocação
  // (o histórico dela já contém as duas). Evita resposta dupla. Só cede se a
  // outra é ESTRITAMENTE mais nova: com timestamp igual (mesmo segundo) as
  // duas responderiam, o que é melhor do que nenhuma responder.
  await dormir(2500)
  const { data: ultimaEntrada } = await supabaseAdmin
    .from('wa_mensagens')
    .select('wamid, criado_em')
    .eq('conversa_id', params.conversaId)
    .eq('direcao', 'entrada')
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (
    ultimaEntrada?.wamid &&
    ultimaEntrada.wamid !== params.wamid &&
    new Date(ultimaEntrada.criado_em).getTime() > new Date(params.criadoEm).getTime()
  ) {
    return
  }

  void marcarComoLida(params.wamid).catch(() => false)

  try {
    const historico = await historicoConversa(params.conversaId)
    let mensagens = historico.msgs
    // Garante que a mensagem que disparou esta resposta está no fim do
    // histórico (se a leitura não a viu, ou se o último turno não é dele).
    const ultima = mensagens[mensagens.length - 1]
    if (!historico.wamids.has(params.wamid) || !ultima || ultima.role !== 'user') {
      const atual = (params.corpo ?? '').trim()
      if (ultima && ultima.role === 'user' && typeof ultima.content === 'string') {
        mensagens = [...mensagens.slice(0, -1), { role: 'user', content: `${ultima.content}\n\n${atual}` }]
      } else {
        mensagens = [...mensagens, { role: 'user', content: atual }]
      }
    }

    // A imagem recém-chegada pode não estar no histórico ainda: o webhook grava
    // e responde quase junto. Sem isto, o print que ele acabou de mandar
    // apareceria como "[imagem]" e o agente pediria pra ele escrever.
    if (params.tipo === 'image' && !historico.wamids.has(params.wamid)) {
      const { data: recem } = await supabaseAdmin
        .from('wa_mensagens')
        .select('midia_path, midia_mime')
        .eq('wamid', params.wamid)
        .maybeSingle<{ midia_path: string | null; midia_mime: string | null }>()
      if (recem?.midia_path) {
        const bloco = await blocoDaImagem(recem.midia_path, recem.midia_mime)
        if (bloco) {
          const legenda = (params.corpo ?? '').trim() || 'Olha esta imagem.'
          const fim = mensagens[mensagens.length - 1]
          // Se o último turno é dele e virou só a legenda vazia, troca pelo par
          // imagem + texto em vez de empilhar um turno de usuário duplicado.
          mensagens =
            fim && fim.role === 'user' && typeof fim.content === 'string' && !fim.content.trim()
              ? [...mensagens.slice(0, -1), { role: 'user', content: [bloco, { type: 'text', text: legenda }] }]
              : [...mensagens, { role: 'user', content: [bloco, { type: 'text', text: legenda }] }]
        }
      }
    }

    const r = await rodarAgente(mensagens, 'gestao-whatsapp')

    let enviado = false
    let erroEnvio: string | null = null
    for (const parte of partirTexto(r.texto)) {
      const envio = await enviarTexto(waId, parte)
      if (!envio.ok) {
        erroEnvio = envio.erro
        break
      }
      enviado = true
      await registrarSaidaInbox(waId, params.nome, envio.wamid, parte, null, 'gestao')
    }

    await gravarLog({
      ...base,
      resposta: r.texto,
      ferramentas: r.ferramentas,
      rodadas: r.rodadas,
      tokens_entrada: r.tokensEntrada,
      tokens_saida: r.tokensSaida,
      duracao_ms: Date.now() - inicio,
      enviado,
      erro: erroEnvio,
    })
  } catch (err) {
    const erro = err instanceof Error ? err.message : String(err)
    console.error('[gestao-wa] responderGestao falhou', { erro })
    const aviso = 'Não consegui responder agora (erro interno). Tenta de novo em um minuto.'
    const r = await enviarTexto(waId, aviso)
    if (r.ok) await registrarSaidaInbox(waId, params.nome, r.wamid, aviso, null, 'gestao')
    await gravarLog({ ...base, resposta: null, ferramentas: [], rodadas: 0, tokens_entrada: 0, tokens_saida: 0, duracao_ms: Date.now() - inicio, enviado: false, erro })
  }
}

// ─── Pauta das 07:00 e das 17:30 (cron) ─────────────────────────────────────

export type ResultadoPauta = {
  tipo: TipoReuniaoDiaria
  destinos: Array<{ wa_id: string; ok: boolean; template: string | null; erro?: string }>
  pauta: string
}

/** Pauta de reserva quando a API do Claude falha: só os números, sem juízo. */
function pautaDeReserva(tipo: TipoReuniaoDiaria, d: Awaited<ReturnType<typeof dadosDaPauta>>): string {
  const agora = d.resumo.placar.agora
  const linhas = [
    tipo === 'manha' ? 'Bom dia, Fernando. Pauta das 07:00:' : 'Boa tarde, Fernando. Pauta das 17:30:',
    `- ${d.cobranca.length} aguardando pagamento (${reais(d.cobranca.reduce((a, i) => a + i.valor_centavos, 0))})`,
    `- ${d.semResposta.length} conversas sem resposta há mais de 2 h`,
    `- ${d.semFornecedor.length} pedidos confirmados sem fornecedor há mais de 24 h`,
    `- ${d.resumo.pendencias_abertas.length} pendências abertas nas últimas atas`,
  ]
  if (typeof agora?.wa_nao_lidas === 'number') linhas.push(`- ${agora.wa_nao_lidas} mensagens não lidas no inbox`)
  linhas.push('Por onde começamos?')
  return linhas.join('\n')
}

async function dadosDaPauta() {
  const [resumo, cobranca, semResposta, semFornecedor] = await Promise.all([
    resumoGestao(),
    filaCobranca(),
    conversasSemResposta(2),
    pedidosSemFornecedor(24),
  ])
  return { resumo, cobranca, semResposta, semFornecedor }
}

function resumoEmUmaLinha(d: Awaited<ReturnType<typeof dadosDaPauta>>): string {
  const total = d.cobranca.reduce((a, i) => a + i.valor_centavos, 0)
  return (
    `${d.cobranca.length} aguardando pagamento (${reais(total)}), ` +
    `${d.semResposta.length} conversas sem resposta, ` +
    `${d.semFornecedor.length} pedidos sem fornecedor, ` +
    `${d.resumo.pendencias_abertas.length} pendências abertas`
  )
}

export async function enviarPauta(tipo: TipoReuniaoDiaria): Promise<ResultadoPauta> {
  const inicio = Date.now()
  const hora = tipo === 'manha' ? '07:00' : '17:30'
  const destinos = numerosGestao()
  const dados = await dadosDaPauta()

  // Pra ficar leve no prompt: listas cortadas e sem campos que não mudam a pauta.
  const compacto = {
    agora_recife: agoraRecife(),
    placar_agora: dados.resumo.placar.agora,
    placar_7d: dados.resumo.placar.d7,
    placar_30d: dados.resumo.placar.d30,
    cobranca: dados.cobranca.slice(0, 15).map((i) => ({ cliente: i.cliente, valor: reais(i.valor_centavos), dias: i.dias_em_aberto, fonte: i.fonte })),
    sem_resposta: dados.semResposta.slice(0, 10).map((c) => ({ contato: c.contato, vinculo: c.vinculo, horas: c.horas_esperando, preview: c.preview })),
    sem_fornecedor: dados.semFornecedor.slice(0, 10).map((p) => ({ cliente: p.cliente, uf: p.uf, resumo: p.resumo, horas: p.horas_esperando, ofertas_no_ar: p.ofertas_no_ar, recusadas: p.ofertas_recusadas })),
    pendencias_abertas: dados.resumo.pendencias_abertas.slice(0, 15),
    decisoes_para_revisar: dados.resumo.decisoes_para_revisar.map((d) => `D-${d.numero} ${d.titulo}`),
    ultimas_reunioes: dados.resumo.ultimas_reunioes.slice(0, 4),
  }

  const pedido =
    tipo === 'manha'
      ? 'Monte a pauta da reunião das 07:00: cumprimente em uma linha, traga a fila do dia (cobrança, sem resposta, sem fornecedor) com nomes, valores e tempo, as pendências que vencem hoje e proponha as 3 prioridades do dia. Feche perguntando por onde ele quer começar.'
      : 'Monte a pauta da reunião das 17:30: cumprimente em uma linha, diga o que mudou desde a manhã (pagamentos, respostas, ofertas aceitas) se der pra ver nos números, o que segue travado, as pendências em aberto e pergunte o que foi feito hoje e o que decidir antes de fechar o dia.'

  let pauta: string
  let ferramentas: ChamadaFerramenta[] = []
  let rodadas = 0
  let tokensEntrada = 0
  let tokensSaida = 0
  let erro: string | null = null
  try {
    const r = await rodarAgente(
      [{ role: 'user', content: `${pedido}\n\nDados do diário de bordo (já consultados, não precisa chamar resumo_gestao):\n${JSON.stringify(compacto)}` }],
      'gestao-whatsapp-pauta'
    )
    pauta = r.texto
    ferramentas = r.ferramentas
    rodadas = r.rodadas
    tokensEntrada = r.tokensEntrada
    tokensSaida = r.tokensSaida
  } catch (err) {
    erro = err instanceof Error ? err.message : String(err)
    console.error('[gestao-wa] pauta pelo Claude falhou, usando reserva', { erro })
    pauta = pautaDeReserva(tipo, dados)
  }

  const resumo = resumoEmUmaLinha(dados)
  const resultado: ResultadoPauta = { tipo, destinos: [], pauta }
  for (const waId of destinos) {
    const envio = await enviarParaGestor(waId, pauta, { hora, resumo })
    resultado.destinos.push(envio.ok ? { wa_id: waId, ok: true, template: envio.template } : { wa_id: waId, ok: false, template: null, erro: envio.erro })
    await gravarLog({
      conversa_id: null,
      wa_id: waId,
      wamid_entrada: null,
      origem: 'pauta',
      mensagem: `pauta ${tipo}`,
      resposta: pauta,
      ferramentas,
      modelo: MODELO,
      rodadas,
      tokens_entrada: tokensEntrada,
      tokens_saida: tokensSaida,
      duracao_ms: Date.now() - inicio,
      enviado: envio.ok,
      erro: envio.ok ? erro : `${erro ? erro + ' | ' : ''}${envio.erro}`,
    })
  }
  if (destinos.length === 0) console.warn('[gestao-wa] WHATSAPP_GESTAO_NUMEROS vazio — pauta não enviada')
  return resultado
}
