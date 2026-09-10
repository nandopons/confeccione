// app/lib/oferta-automatica.ts
// ============================================================================
// FILA DE OFERTA — uma confecção por vez (09/09/2026)
//
// Regra definida pelo Fernando:
//   • o pedido vai pra UMA confecção, a de melhor match
//   • ela tem 3 horas COMERCIAIS pra aceitar ou recusar (7h–19h de Recife)
//   • cada confecção segura no máximo 2 ofertas ao mesmo tempo
//   • venceu ou recusou, passa pra próxima da lista
//   • acabou a lista, o pedido vai pra captação de confecção nova
//
// POR QUE FILA E NÃO LEILÃO
// Mandar o mesmo pedido pra 43 confecções de uma vez parece mais rápido e é
// mais lento: ninguém se sente dono, todo mundo espera outro responder, e a
// que aceita descobre que outras cinco também viram. Uma por vez cria dono e
// dá um prazo real de resposta.
//
// O TETO DE 2 é o que impede a fila de sempre escolher a mesma confecção boa.
// Sem ele, a melhor pontuada receberia todo pedido novo e viraria gargalo — a
// fila estaria "funcionando" enquanto a operação trava numa pessoa só.
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import { dentroDoHorarioComercial, somarHorasComerciais } from './horario-comercial'
import { ofertarPedido, ordenarFornecedoresPara, resumirLinhas, type FornecedorOpcao, type LinhaPedido } from './pedido-assistente-oferta'

/** Quanto tempo a confecção tem pra responder, em horas comerciais. */
export const HORAS_PARA_RESPONDER = 3

/**
 * Pedido com prazo apertado não pode esperar 3 horas por confecção.
 *
 * O cliente diz o prazo na conversa e ele vai gravado em `prazo_dias`: dos 204
 * pedidos dos últimos 90 dias, 160 têm prazo, a média é 17 dias — e 37 pedem
 * 10 dias ou menos, com o menor em 7.
 *
 * Com fila de um por vez, cada silêncio custa 3 horas comerciais, ou seja meio
 * dia útil. Cinco confecções caladas viram dois dias corridos só pra descobrir
 * que ninguém pegou. Num pedido de 7 dias isso queima um terço do prazo antes
 * de existir fornecedor — e aí não adianta mais aceitar.
 *
 * Então a janela encolhe junto com o prazo. Continua uma confecção por vez (é
 * ela que decide), só que o "não respondeu" chega mais rápido quando o
 * calendário aperta.
 */
export function horasParaResponder(prazoDias: number | null | undefined): number {
  if (prazoDias == null) return HORAS_PARA_RESPONDER
  if (prazoDias <= 7) return 1
  if (prazoDias <= 15) return 2
  return HORAS_PARA_RESPONDER
}

/** Ofertas em aberto que uma confecção pode segurar ao mesmo tempo. */
export const MAX_OFERTAS_ABERTAS = 2

/** Teto de pedidos tratados por rodada — cron roda a cada 10 min. */
const MAX_POR_RODADA = 10

/**
 * Pedido parado além disto não entra na fila automática.
 *
 * POR QUE ISTO EXISTE — 10/09/2026
 * A fila ordena do mais antigo pro mais novo, o que é justo enquanto ela roda.
 * Só que ela nunca rodou: no dia em que ligarmos, há 32 pedidos represados e os
 * dez primeiros seriam de JUNHO, parados há 85 dias. A primeira coisa que a
 * automação faria seria oferecer a uma confecção um pedido que o cliente fez há
 * três meses — e empurrar os de hoje (a Ias, de 200 peças) pro fim da fila.
 *
 * Isso queima os dois lados: a confecção gasta atenção com algo que o cliente
 * provavelmente já resolveu em outro lugar, e a gente aparece desorganizado
 * logo na mensagem que devia abrir relação.
 *
 * Pedido antigo não fica órfão: ele continua no painel e o botão "Ofertar"
 * manual segue funcionando. O que a automação não faz é ressuscitar sozinha um
 * acervo parado — quem decide que vale a pena reabrir é o Fernando, olhando.
 *
 * Se um dia a fila estiver rodando em dia, este número pode subir sem medo:
 * ele existe pro represamento inicial, não pro regime normal.
 */
const MAX_DIAS_PARADO = 30

export type ResultadoFila = {
  expiradas: number
  ofertados: Array<{ pedido: string; fornecedor: string }>
  semCandidato: string[]
  observacao?: string
}

/**
 * Fecha as ofertas que passaram do prazo.
 *
 * Roda SEMPRE, inclusive fora do horário comercial: expirar não incomoda
 * ninguém, e deixar pra expirar de manhã atrasaria a próxima oferta em horas.
 */
async function expirarVencidas(): Promise<number> {
  const { data } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .update({ status: 'cancelada', respondido_em: new Date().toISOString() })
    .eq('status', 'ofertada')
    .not('expira_em', 'is', null)
    .lt('expira_em', new Date().toISOString())
    .select('id')
  return (data ?? []).length
}

type PedidoFila = {
  id: string
  codigo: string | null
  cidade: string | null
  uf: string | null
  categoria: string | null
  pecas: string[] | null
  linhas: unknown
  prazo_dias: number | null
}

/** Pedidos confirmados que ainda não têm confecção nem oferta em aberto. */
async function pedidosNaFila(): Promise<PedidoFila[]> {
  // O corte por idade vai no banco pra não gastar a janela de 60 lendo pedido
  // de junho que seria descartado depois — sem ele, os represados ocupariam a
  // consulta inteira e os de hoje nem apareceriam.
  const limite = new Date(Date.now() - MAX_DIAS_PARADO * 24 * 60 * 60 * 1000).toISOString()

  // A ETAPA NÃO BASTA: EXIGIMOS O ACEITE DO CLIENTE — 10/09/2026.
  //
  // A view de etapas classifica como `buscando_fornecedor` quem tem
  // `status = 'confirmado'` OU `ofertas_total > 0` (migration 20260908010000,
  // linha 160). Esse OR é uma porta dos fundos: basta UMA oferta manual pra o
  // pedido passar a parecer liberado, e a fila automática assumir o volante de
  // um pedido que o cliente nunca autorizou.
  //
  // Foi o que houve com o 20260900274: oferta manual às 10:26 e, sem ninguém
  // pedir, a fila mandou pro Rodolfo às 11:48 e pro Joaquim às 15:57 — três
  // confecções vendo um pedido que a cliente não tinha soltado. Em 10/09 havia
  // 24 pedidos ofertados sem `confirmado_em`.
  //
  // A trava vai aqui, e não na view: a view serve o painel, onde mostrar o
  // pedido no grupo "fornecedor" depois de ofertado está CERTO — é onde ele
  // está de fato. Quem não pode agir sozinha sem autorização é a automação.
  //
  // `confirmado_em` é gravado por liberarParaFornecedores, que é o que o
  // cliente aciona no "Buscar fornecedor" e o Luigi chama com o sim dele.
  const { data } = await supabaseAdmin
    .from('pedidos_assistente_etapas')
    .select('id, codigo, cidade, uf, categoria, pecas, linhas, prazo_dias, etapa, desde, confirmado_em')
    .in('etapa', ['buscando_fornecedor', 'sem_fornecedor'])
    .not('confirmado_em', 'is', null)
    .gte('desde', limite)
    .order('desde', { ascending: true })
    .limit(60)

  const candidatos = (data ?? []) as Array<PedidoFila & { etapa: string }>
  if (candidatos.length === 0) return []

  // Quem já tem oferta viva não entra: um pedido, uma confecção por vez.
  const { data: vivas } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('pedido_id')
    .in('status', ['ofertada', 'aceita'])
    .in('pedido_id', candidatos.map((p) => p.id))
  const ocupados = new Set(((vivas ?? []) as Array<{ pedido_id: string }>).map((o) => o.pedido_id))

  return candidatos.filter((p) => !ocupados.has(p.id)).slice(0, MAX_POR_RODADA)
}

/** Confecções que podem receber oferta agora (respeitando o teto de 2). */
async function candidatosDisponiveis(pedidoId: string): Promise<FornecedorOpcao[]> {
  const { data: forn } = await supabaseAdmin
    .from('leads_fornecedores')
    .select('id, nome, whatsapp, cidade, estado, status, tipos_produto, pedido_minimo, prazo_minimo_dias')
    .eq('aprovacao_status', 'aprovado')
    .eq('status', 'ativo')
    .is('pausado_em', null)
  const todos = (forn ?? []) as FornecedorOpcao[]
  if (todos.length === 0) return []

  // Já recebeu ESTE pedido alguma vez? Não recebe de novo — inclusive se
  // recusou. Insistir com quem já disse não é o começo do descadastro.
  const { data: jaViu } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('fornecedor_id')
    .eq('pedido_id', pedidoId)
  const viram = new Set(((jaViu ?? []) as Array<{ fornecedor_id: string }>).map((o) => o.fornecedor_id))

  // Quantas ofertas em aberto cada uma segura agora.
  const { data: abertas } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('fornecedor_id')
    .eq('status', 'ofertada')
  const carga = new Map<string, number>()
  for (const o of (abertas ?? []) as Array<{ fornecedor_id: string }>) {
    carga.set(o.fornecedor_id, (carga.get(o.fornecedor_id) ?? 0) + 1)
  }

  return todos.filter((f) => !viram.has(f.id) && (carga.get(f.id) ?? 0) < MAX_OFERTAS_ABERTAS)
}

/**
 * Uma rodada da fila. Idempotente: rodar duas vezes seguidas não manda a mesma
 * oferta duas vezes, porque a primeira já deixou o pedido com oferta viva.
 */
export async function rodarFilaDeOfertas(): Promise<ResultadoFila> {
  const expiradas = await expirarVencidas()

  if (!dentroDoHorarioComercial()) {
    return { expiradas, ofertados: [], semCandidato: [], observacao: 'fora do horário de envio (7h–19h)' }
  }

  const pedidos = await pedidosNaFila()
  const ofertados: ResultadoFila['ofertados'] = []
  const semCandidato: string[] = []

  for (const p of pedidos) {
    const disponiveis = await candidatosDisponiveis(p.id)
    if (disponiveis.length === 0) {
      // A lista acabou: ou todas já viram este pedido, ou estão no teto. Isso
      // não é erro, é sinal de que falta confecção com esse perfil — e é
      // exatamente o gatilho da captação.
      semCandidato.push(p.codigo ?? p.id)
      continue
    }

    const linhas = Array.isArray(p.linhas) ? (p.linhas as LinhaPedido[]) : []
    const { totalPecas } = resumirLinhas(linhas)

    // No automático só entra quem o match considera VIÁVEL: pedido abaixo do
    // mínimo dela (já com os 20% de margem) ou prazo mais curto do que ela
    // aceita não vira oferta. A tela manual continua mostrando todo mundo — lá
    // tem uma pessoa que pode saber de algo que o cadastro não sabe.
    const escolhido = ordenarFornecedoresPara({ ...p, prazoDias: p.prazo_dias }, disponiveis, totalPecas || null).find(
      (f) => f.match.viavel
    )
    if (!escolhido) {
      semCandidato.push(p.codigo ?? p.id)
      continue
    }

    const r = await ofertarPedido(p.id, [escolhido.id])
    if (!r.ok || r.criadas === 0) continue

    // O prazo é gravado DEPOIS do envio, com a hora do envio: é o combinado
    // que a confecção viu, e não muda se a janela mudar amanhã.
    await supabaseAdmin
      .from('ofertas_pedido_assistente')
      .update({ expira_em: somarHorasComerciais(horasParaResponder(p.prazo_dias)).toISOString(), origem: 'automatica' })
      .eq('pedido_id', p.id)
      .eq('fornecedor_id', escolhido.id)
      .eq('status', 'ofertada')

    ofertados.push({ pedido: p.codigo ?? p.id, fornecedor: escolhido.nome ?? escolhido.id })
  }

  return { expiradas, ofertados, semCandidato }
}
