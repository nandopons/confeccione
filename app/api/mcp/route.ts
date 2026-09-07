// app/api/mcp/route.ts
// ============================================================================
// SERVIDOR MCP DA CONFECCIONE — v1 (07/09/2026).
//
// MCP (Model Context Protocol) é o padrão pelo qual um modelo de IA descobre e
// chama ferramentas de um sistema. Este endpoint faz do site um "servidor":
// o Claude (Cowork, Claude Code, claude.ai) conecta aqui e ganha ferramentas
// com nome, descrição e parâmetros — e passa a agir pela porta do produto,
// com as regras do produto, em vez de mexer no banco por fora.
//
// O QUE A V1 EXPÕE (só leitura + registro no diário de bordo):
//   ler_placar / gravar_placar          → os nove indicadores (calcular_placar)
//   fila_cobranca                       → orçamento definido sem pagamento
//   conversas_sem_resposta              → cauda do p90 do atendimento
//   pedidos_sem_fornecedor              → confirmados sem oferta aceita
//   registrar_decisao / buscar_decisoes / atualizar_decisao
//   registrar_reuniao / buscar_reunioes
//   resumo_gestao                       → tudo que a reunião de segunda precisa
//   templates_whatsapp                  → status dos templates na WABA
//   criar_template_whatsapp             → submete template pra aprovação da
//                                         Meta (configuração, exige confirmar)
//   enviar_pauta_gestao                 → pauta da reunião pro WhatsApp do
//                                         gestor (D-7, exige confirmar)
//   funil_etapas / pedidos_por_etapa    → a etapa de cada pedido (D-8)
//   registrar_motivo_parada             → por que o cliente parou
//   encerrar_pedido                     → perdido, com motivo (D-8, exige
//                                         confirmar; pago não se encerra)
//
// O QUE NÃO EXPÕE, de propósito: enviar mensagem, cobrar, mexer em pedido,
// dinheiro. Ação com efeito externo entra em versão futura, uma por vez, com
// confirmação explícita (nível N1 do mapa de autonomia). Criar template não
// manda nada pra ninguém — é catálogo; por isso entrou na v1.1 (07/09).
//
// TRANSPORTE: Streamable HTTP em modo stateless (sem sessão, resposta JSON),
// via WebStandardStreamableHTTPServerTransport da SDK oficial — cada POST
// cria servidor + transporte, responde e descarta. Cabe em serverless.
//
// AUTENTICAÇÃO: token próprio (env MCP_TOKEN), separado do cookie admin.
//   - Authorization: Bearer <token>   (Claude Code, clientes com header)
//   - ?key=<token>                     (conectores que só aceitam URL)
// Sem MCP_TOKEN configurado o endpoint responde 503 e não faz nada.
// Rotação: trocar a env e atualizar o conector. O token na URL fica em log de
// acesso — por isso a v1 é só leitura e registro de texto.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { compararSeguro } from '@/app/lib/admin-auth'
import {
  atualizarDecisao,
  buscarDecisao,
  calcularPlacar,
  conversasSemResposta,
  filaCobranca,
  gravarPlacar,
  listarDecisoes,
  listarPlacares,
  listarReunioes,
  pedidosSemFornecedor,
  registrarDecisao,
  registrarReuniao,
  resumoGestao,
  STATUS_DECISAO,
  TEMAS_DECISAO,
  TIPOS_REUNIAO,
} from '@/app/lib/diario'
import { consultarTemplatesWhatsApp, criarTemplateWhatsApp } from '@/app/lib/whatsapp-templates'
import { enviarPauta, numerosGestao } from '@/app/lib/gestao-whatsapp'
import {
  acharPedido,
  contagemPorEtapa,
  encerrarPedido,
  ETAPAS,
  MOTIVOS_ENCERRAMENTO,
  pedidosPorEtapa,
  registrarMotivoParada,
} from '@/app/lib/etapas-pedido'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

// ─── Auth ───────────────────────────────────────────────────────────────────

function tokenDoRequest(req: NextRequest): string | null {
  const auth = req.headers.get('authorization')
  if (auth && /^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, '').trim()
  const key = req.nextUrl.searchParams.get('key')
  return key ? key.trim() : null
}

function autorizado(req: NextRequest): 'ok' | 'sem_token_env' | 'negado' {
  const esperado = process.env.MCP_TOKEN
  if (!esperado || esperado.length < 24) return 'sem_token_env'
  const recebido = tokenDoRequest(req)
  if (!recebido) return 'negado'
  return compararSeguro(recebido, esperado) ? 'ok' : 'negado'
}

// ─── Ferramentas ────────────────────────────────────────────────────────────

/** Resultado padrão: JSON legível no bloco de texto. */
function texto(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] }
}

function erro(mensagem: string) {
  return { isError: true, content: [{ type: 'text' as const, text: mensagem }] }
}

const SOMENTE_LEITURA = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
const REGISTRO = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }

const DataISO = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'use AAAA-MM-DD')

function criarServidor(): McpServer {
  const server = new McpServer({ name: 'confeccione', version: '1.2.0' })

  server.registerTool(
    'ler_placar',
    {
      title: 'Placar da Confeccione',
      description:
        'Os nove indicadores do placar semanal, calculados agora no banco (função calcular_placar): site, pedidos, ofertas, ' +
        'orçamentos avulsos, fornecedores, atendimento, nutrição e guardrails, em janelas de 7 e 30 dias, mais as filas ' +
        'abertas ("agora"). Valores monetários vêm em centavos. Não grava nada.',
      inputSchema: {},
      annotations: SOMENTE_LEITURA,
    },
    async () => texto(await calcularPlacar())
  )

  server.registerTool(
    'gravar_placar',
    {
      title: 'Gravar a foto da semana',
      description:
        'Calcula o placar agora e grava como a foto oficial da semana corrente (segunda-feira, fuso de Recife). ' +
        'Regravar a mesma semana substitui a foto anterior. Use na reunião de segunda ou quando um número mudar de patamar.',
      inputSchema: {
        observacoes: z.string().max(2000).optional().describe('Nota curta sobre o contexto da foto (opcional).'),
      },
      annotations: REGISTRO,
    },
    async ({ observacoes }) => texto(await gravarPlacar('mcp', observacoes ?? null))
  )

  server.registerTool(
    'historico_placar',
    {
      title: 'Histórico do placar',
      description: 'As últimas fotos semanais gravadas, da mais recente pra mais antiga. Serve pra ver tendência.',
      inputSchema: { semanas: z.number().int().min(1).max(52).optional().describe('Quantas semanas (padrão 8).') },
      annotations: SOMENTE_LEITURA,
    },
    async ({ semanas }) => texto(await listarPlacares(semanas ?? 8))
  )

  server.registerTool(
    'fila_cobranca',
    {
      title: 'Fila de cobrança',
      description:
        'Quem tem orçamento definido e ainda não pagou: pedidos do chat (status confirmado + orçamento definido + não pago) ' +
        'e orçamentos avulsos com cobrança gerada no Asaas. Ordenado do mais antigo em aberto pro mais novo. É a receita ' +
        'mais próxima que existe — cada item deveria receber contato em até 48 h.',
      inputSchema: {},
      annotations: SOMENTE_LEITURA,
    },
    async () => texto(await filaCobranca())
  )

  server.registerTool(
    'conversas_sem_resposta',
    {
      title: 'Conversas do WhatsApp sem resposta',
      description:
        'Conversas do inbox oficial cuja última mensagem é do contato (cliente ou fornecedor) e está há mais de N horas ' +
        'sem resposta nossa, nos últimos 7 dias. É a cauda do p90 do atendimento.',
      inputSchema: { horas: z.number().min(0).max(720).optional().describe('Mínimo de horas esperando (padrão 2).') },
      annotations: SOMENTE_LEITURA,
    },
    async ({ horas }) => texto(await conversasSemResposta(horas ?? 2))
  )

  server.registerTool(
    'pedidos_sem_fornecedor',
    {
      title: 'Pedidos confirmados sem fornecedor',
      description:
        'Pedidos confirmados pelo cliente há mais de N horas sem nenhuma oferta aceita por fornecedor, com quantas ofertas ' +
        'estão no ar e quantas foram recusadas. É onde o mapa de lacunas de fornecedores (segmento × estado) começa.',
      inputSchema: { horas: z.number().min(0).max(2000).optional().describe('Mínimo de horas desde a confirmação (padrão 24).') },
      annotations: SOMENTE_LEITURA,
    },
    async ({ horas }) => texto(await pedidosSemFornecedor(horas ?? 24))
  )

  server.registerTool(
    'registrar_decisao',
    {
      title: 'Registrar uma decisão',
      description:
        'Grava uma decisão de gestão no diário de bordo: o que passa a valer, alternativas descartadas, motivo, números que ' +
        'embasaram e quando revisar. Decisão sem data de revisão vira dogma — sugira uma. Só registre o que o Fernando ' +
        'decidiu de fato nesta conversa; não registre sugestões suas como decisão.',
      inputSchema: {
        tema: z.enum(TEMAS_DECISAO).describe('Área: whatsapp, marketing, produto, fornecedores, financeiro, engenharia, gestao.'),
        titulo: z.string().min(3).max(140).describe('Título curto, ex.: "WhatsApp só pela API oficial".'),
        decisao: z.string().min(3).max(2000).describe('A decisão em uma ou duas frases, no imperativo do que passa a valer.'),
        contexto: z.string().max(3000).optional().describe('O que estava acontecendo quando foi decidido.'),
        alternativas: z.string().max(3000).optional().describe('Alternativas descartadas e por quê.'),
        motivo: z.string().max(3000).optional(),
        numeros: z.record(z.string(), z.union([z.number(), z.string()])).optional().describe('Indicadores que embasaram, ex.: {"pagos_30d": 0}.'),
        revisar_em: DataISO.optional().describe('Data de revisão (AAAA-MM-DD).'),
        documento: z.string().max(300).optional().describe('Documento do projeto que detalha, ex.: claude/sistema-operacional-escala.md.'),
        reuniao_id: z.string().uuid().optional().describe('Ata em que foi decidida, se houver.'),
        decidido_em: DataISO.optional().describe('Data da decisão, se não for hoje.'),
      },
      annotations: REGISTRO,
    },
    async (d) => texto(await registrarDecisao({ ...d, origem: 'mcp' }))
  )

  server.registerTool(
    'buscar_decisoes',
    {
      title: 'Buscar decisões',
      description:
        'Lista decisões do diário de bordo, da mais recente pra mais antiga. Filtre por status (vigente, revisada, revogada), ' +
        'tema, texto livre, ou peça só as que estão com revisão vencida (para_revisar). Consulte ANTES de propor algo que ' +
        'pode já ter sido decidido.',
      inputSchema: {
        status: z.enum([...STATUS_DECISAO, 'todas']).optional().describe('Padrão: vigente.'),
        tema: z.enum(TEMAS_DECISAO).optional(),
        texto: z.string().max(200).optional().describe('Busca em título, decisão, contexto e motivo.'),
        para_revisar: z.boolean().optional().describe('Só as vigentes com revisar_em até hoje.'),
        limite: z.number().int().min(1).max(200).optional(),
      },
      annotations: SOMENTE_LEITURA,
    },
    async ({ status, tema, texto: t, para_revisar, limite }) =>
      texto(await listarDecisoes({ status: status ?? 'vigente', tema, texto: t, paraRevisar: para_revisar, limite }))
  )

  server.registerTool(
    'atualizar_decisao',
    {
      title: 'Atualizar status de uma decisão',
      description:
        'Decisão não se apaga: muda de status (revisada ou revogada), ganha nova data de revisão ou aponta pra decisão que ' +
        'a substituiu. Identifique pelo número (D-12 → 12) ou pelo id.',
      inputSchema: {
        numero: z.number().int().positive().optional(),
        id: z.string().uuid().optional(),
        status: z.enum(STATUS_DECISAO).optional(),
        revisar_em: DataISO.nullable().optional(),
        substituida_por: z.string().uuid().nullable().optional(),
        motivo: z.string().max(3000).optional().describe('Por que mudou (acrescenta ao registro).'),
      },
      annotations: REGISTRO,
    },
    async ({ numero, id, status, revisar_em, substituida_por, motivo }) => {
      const alvo = await buscarDecisao({ id, numero })
      if (!alvo) return erro('Decisão não encontrada. Informe numero ou id válidos.')
      return texto(await atualizarDecisao(alvo.id, { status, revisar_em, substituida_por, motivo }))
    }
  )

  server.registerTool(
    'registrar_reuniao',
    {
      title: 'Registrar ata de reunião',
      description:
        'Grava a ata de uma reunião de gestão: segunda (placar + prioridades), sexta (fechamento), mensal (financeiro) ou ' +
        'sessao (sessão de trabalho com o assistente). Resumo curto em markdown; pendências com dono e prazo. Se a reunião ' +
        'gerou decisões, registre-as com registrar_decisao passando o id desta ata.',
      inputSchema: {
        tipo: z.enum(TIPOS_REUNIAO),
        titulo: z.string().min(3).max(140),
        resumo: z.string().min(10).max(12000).describe('A ata em markdown: o que foi olhado, decidido e o que ficou pendente.'),
        pauta: z.string().max(3000).optional(),
        numeros: z.record(z.string(), z.union([z.number(), z.string()])).optional().describe('Números citados.'),
        pendencias: z
          .array(
            z.object({
              descricao: z.string().min(2).max(300),
              dono: z.string().max(60).optional(),
              prazo: DataISO.optional(),
              feita: z.boolean().optional(),
            })
          )
          .max(30)
          .optional(),
        placar_id: z.string().uuid().optional().describe('Foto do placar usada na reunião (id de gravar_placar).'),
        realizada_em: z.iso.datetime({ offset: true }).optional().describe('Quando aconteceu, se não for agora (ISO 8601).'),
      },
      annotations: REGISTRO,
    },
    async (r) => texto(await registrarReuniao({ ...r, origem: 'mcp' }))
  )

  server.registerTool(
    'buscar_reunioes',
    {
      title: 'Buscar atas',
      description: 'As últimas atas de reunião, com pendências. Leia as últimas 4 antes de uma reunião de segunda.',
      inputSchema: {
        tipo: z.enum(TIPOS_REUNIAO).optional(),
        limite: z.number().int().min(1).max(100).optional().describe('Padrão 10.'),
      },
      annotations: SOMENTE_LEITURA,
    },
    async ({ tipo, limite }) => texto(await listarReunioes({ tipo, limite: limite ?? 10 }))
  )

  server.registerTool(
    'resumo_gestao',
    {
      title: 'Resumo pra reunião de gestão',
      description:
        'Tudo que a reunião de segunda (e o briefing das 06:45) precisa numa chamada: placar de agora, última foto gravada, ' +
        'decisões com revisão vencida, decisões vigentes recentes, pendências em aberto das últimas atas.',
      inputSchema: {},
      annotations: SOMENTE_LEITURA,
    },
    async () => texto(await resumoGestao())
  )

  server.registerTool(
    'templates_whatsapp',
    {
      title: 'Templates do WhatsApp na WABA',
      description:
        'Lista os templates de mensagem da WABA da Confeccione com status (APPROVED, PENDING, REJECTED e motivo), categoria e ' +
        'corpo. Use pra saber quais aberturas estão aprovadas antes de propor um disparo, ou pra acompanhar uma submissão.',
      inputSchema: {
        nomes: z.array(z.string().min(3).max(512)).max(50).optional().describe('Filtra por nome exato (opcional).'),
      },
      annotations: SOMENTE_LEITURA,
    },
    async ({ nomes }) => {
      const r = await consultarTemplatesWhatsApp(nomes)
      return r.ok ? texto(r.templates) : erro(`Não deu pra consultar a WABA: ${r.erro}`)
    }
  )

  server.registerTool(
    'criar_template_whatsapp',
    {
      title: 'Submeter template do WhatsApp pra aprovação',
      description:
        'Submete um template de mensagem à Meta (WABA da Confeccione). É configuração de catálogo: não envia mensagem a ' +
        'ninguém. Corpo com {{1}}, {{2}}… e um exemplo por variável. UTILITY precisa referir uma transação do cliente ' +
        '(pedido, orçamento); a Meta pode reclassificar pra MARKETING. Só chame com confirmar=true depois de o Fernando ' +
        'aprovar o texto nesta conversa.',
      inputSchema: {
        nome: z.string().min(3).max(512).describe('snake_case, ex.: duvida_pedido_manha'),
        categoria: z.enum(['UTILITY', 'MARKETING']),
        corpo: z.string().min(10).max(1024).describe('Texto com {{1}}, {{2}}… Sem emoji.'),
        exemplos: z.array(z.string().min(1).max(200)).max(10).optional().describe('Um exemplo por variável, na ordem.'),
        rodape: z.string().max(60).optional(),
        permitir_troca_categoria: z.boolean().optional().describe('Padrão true.'),
        confirmar: z.boolean().describe('Precisa ser true — o Fernando aprovou o texto.'),
      },
      annotations: REGISTRO,
    },
    async ({ nome, categoria, corpo, exemplos, rodape, permitir_troca_categoria, confirmar }) => {
      if (!confirmar) return erro('Submissão não confirmada: peça a aprovação do texto e chame de novo com confirmar=true.')
      const r = await criarTemplateWhatsApp({ nome, categoria, corpo, exemplos, rodape, permitirTrocaCategoria: permitir_troca_categoria })
      return r.ok ? texto(r) : erro(`A Meta recusou a submissão de ${nome}: ${r.erro}`)
    }
  )

  server.registerTool(
    'funil_etapas',
    {
      title: 'Funil: pedidos por etapa',
      description:
        'Quantos pedidos do site estão em cada etapa (view pedidos_assistente_etapas, D-8): captado, pedido_completo, inativo, ' +
        'buscando_fornecedor, sem_fornecedor, em_negociacao, orcamento_atrasado, aguardando_pagamento, sem_resposta, ' +
        'orcamento_vencido, pago, em_producao, pronto, entregue, finalizado, encerrado, cancelado — com o valor somado.',
      inputSchema: {},
      annotations: SOMENTE_LEITURA,
    },
    async () => texto(await contagemPorEtapa())
  )

  server.registerTool(
    'pedidos_por_etapa',
    {
      title: 'Pedidos numa etapa',
      description:
        'Lista os pedidos que estão na(s) etapa(s) pedida(s), do mais tempo parado pro mais recente: nome, telefone, valor, ' +
        'desde quando está na etapa, última mensagem do cliente, motivo de parada. Use pra montar régua, fila ou cobrança.',
      inputSchema: {
        etapas: z.array(z.enum(ETAPAS)).min(1).max(6),
        limite: z.number().int().min(1).max(200).optional().describe('Padrão 50.'),
      },
      annotations: SOMENTE_LEITURA,
    },
    async ({ etapas, limite }) => {
      const lista = await pedidosPorEtapa(etapas, limite ?? 50)
      return texto(
        lista.map((p) => ({
          id: p.id,
          codigo: p.codigo,
          nome: p.nome,
          telefone: p.telefone,
          email: p.email,
          uf: p.uf,
          etapa: p.etapa,
          desde: p.desde,
          valor_centavos: p.valor_centavos,
          ultimo_contato_cliente_em: p.ultimo_contato_cliente_em,
          motivo_parada: p.motivo_parada,
          ofertas_no_ar: p.ofertas_no_ar,
          ofertas_recusadas: p.ofertas_recusadas,
          peca_completa: p.peca_completa,
        }))
      )
    }
  )

  server.registerTool(
    'registrar_motivo_parada',
    {
      title: 'Registrar por que o cliente parou',
      description:
        'Grava, no pedido, o motivo pelo qual o cliente não avançou (esperando data, achou caro, não gostou do fornecedor…), ' +
        'sem encerrar: o pedido continua aberto e o motivo vira número no placar. Referência = código (2026090…), número ou id.',
      inputSchema: {
        pedido: z.string().min(3).max(60).describe('Código, número ou id do pedido.'),
        motivo: z.string().min(3).max(500),
      },
      annotations: REGISTRO,
    },
    async ({ pedido, motivo }) => {
      const p = await acharPedido(pedido)
      if (!p) return erro(`Pedido "${pedido}" não encontrado.`)
      const r = await registrarMotivoParada(p.id, motivo)
      return texto({ id: r.id, codigo: r.codigo, nome: r.nome, etapa: r.etapa, motivo_parada: r.motivo_parada })
    }
  )

  server.registerTool(
    'encerrar_pedido',
    {
      title: 'Encerrar pedido como perdido',
      description:
        'Dá o pedido como perdido, com motivo (achou_caro, data, atendimento, sumiu, outro). Só por decisão do Fernando nesta ' +
        'conversa (D-8): chame com confirmar=true depois de ele confirmar. Pedido pago não se encerra. Dá pra reabrir pelo admin.',
      inputSchema: {
        pedido: z.string().min(3).max(60).describe('Código, número ou id do pedido.'),
        motivo: z.enum(MOTIVOS_ENCERRAMENTO),
        observacao: z.string().max(500).optional(),
        confirmar: z.boolean().describe('Precisa ser true — o Fernando confirmou.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ pedido, motivo, observacao, confirmar }) => {
      if (!confirmar) return erro('Encerramento não confirmado: confirme com o Fernando e chame de novo com confirmar=true.')
      const p = await acharPedido(pedido)
      if (!p) return erro(`Pedido "${pedido}" não encontrado.`)
      try {
        const r = await encerrarPedido(p.id, motivo, 'mcp', observacao ?? null)
        return texto({ id: r.id, codigo: r.codigo, nome: r.nome, etapa: r.etapa, encerrado_motivo: r.encerrado_motivo })
      } catch (e) {
        return erro(e instanceof Error ? e.message : String(e))
      }
    }
  )

  server.registerTool(
    'enviar_pauta_gestao',
    {
      title: 'Mandar a pauta da reunião pro WhatsApp do gestor',
      description:
        'Monta a pauta da reunião (manha = 07:00, tarde = 17:30) a partir do diário de bordo e manda pro WhatsApp do ' +
        'Fernando (WHATSAPP_GESTAO_NUMEROS) — é o mesmo que o cron faz nos horários. Só vai pro gestor, nunca a cliente ' +
        'ou fornecedor. Use pra testar o fluxo ou quando ele pedir a pauta fora de hora; exige confirmar=true.',
      inputSchema: {
        tipo: z.enum(['manha', 'tarde']),
        confirmar: z.boolean().describe('Precisa ser true — o Fernando pediu ou aprovou o envio.'),
      },
      annotations: REGISTRO,
    },
    async ({ tipo, confirmar }) => {
      if (!confirmar) return erro('Envio não confirmado: chame de novo com confirmar=true.')
      if (numerosGestao().length === 0) return erro('WHATSAPP_GESTAO_NUMEROS não configurado na Vercel — ninguém pra receber.')
      const r = await enviarPauta(tipo)
      return r.destinos.every((d) => d.ok) ? texto(r) : erro(`Pauta montada, mas o envio falhou: ${JSON.stringify(r.destinos)}`)
    }
  )

  return server
}

// ─── HTTP ───────────────────────────────────────────────────────────────────

function respostaAuth(estado: 'sem_token_env' | 'negado'): NextResponse {
  if (estado === 'sem_token_env') {
    return NextResponse.json({ erro: 'Servidor MCP desativado: MCP_TOKEN não configurado.' }, { status: 503 })
  }
  return NextResponse.json(
    { erro: 'Não autorizado. Use Authorization: Bearer <token> ou ?key=<token>.' },
    { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="confeccione-mcp"' } }
  )
}

export async function POST(req: NextRequest) {
  const estado = autorizado(req)
  if (estado !== 'ok') return respostaAuth(estado)

  const server = criarServidor()
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless: cada request é independente
    enableJsonResponse: true, // resposta JSON simples em vez de SSE
  })

  try {
    await server.connect(transport)
    // O transporte lê o body do Request, despacha pro servidor e devolve a Response.
    return await transport.handleRequest(req)
  } catch (e) {
    console.error('[mcp] falha ao tratar request', e)
    return NextResponse.json(
      { jsonrpc: '2.0', error: { code: -32603, message: 'Erro interno no servidor MCP' }, id: null },
      { status: 500 }
    )
  } finally {
    // Sem sessão não há nada pra manter vivo entre requests.
    void transport.close().catch(() => {})
  }
}

// Em modo stateless não há stream de notificações (GET) nem sessão pra
// encerrar (DELETE). 405 é o que a especificação pede nesses casos.
export async function GET(req: NextRequest) {
  const estado = autorizado(req)
  if (estado !== 'ok') return respostaAuth(estado)
  return NextResponse.json(
    { erro: 'Este servidor MCP é stateless: use POST.' },
    { status: 405, headers: { Allow: 'POST' } }
  )
}

export async function DELETE(req: NextRequest) {
  const estado = autorizado(req)
  if (estado !== 'ok') return respostaAuth(estado)
  return NextResponse.json({ erro: 'Sem sessão pra encerrar.' }, { status: 405, headers: { Allow: 'POST' } })
}
