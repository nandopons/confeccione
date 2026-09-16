// app/lib/saude-ia.ts
// ============================================================================
// O QUE FAZER QUANDO A API DE IA FALHA — 15/09/2026.
//
// Duas coisas que não existiam e custaram cliente:
//
//   1. REPROCESSAR. Em 15/09 o saldo da Anthropic zerou e três clientes
//      escreveram entre 10:55 e 13:22 sem receber nada. O turno morria e a
//      mensagem deles ficava sem resposta pra sempre — quando o saldo voltou,
//      ninguém voltou atrás. Agora o Luigi diz "já te respondo" (ver o catch de
//      responderCliente) e ISTO é o que cumpre a promessa. Sem esta parte,
//      aquela frase é mentira com outra roupa.
//
//   2. AVISAR ANTES DE ZERAR. Foi a segunda vez em seis dias (09/09 e 15/09), e
//      nas duas a descoberta foi por acidente. Não existe endpoint público de
//      saldo, então o alarme é por CONSUMO, com o que já está medido em
//      `uso_ia`.
//
// Por que aqui e não no scheduler: `route.ts` deixou de importar do luigi.ts em
// 10/09 e a trilha de execução de rotina mora no Postgres, não no console (os
// logs de runtime da Vercel não capturam console.*).
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import { avisarGestor, responderCliente } from './luigi'

/** Erros de API que merecem nova tentativa — falha de infra, não de conversa. */
const ERRO_DE_API = /credit balance|rate_limit|overloaded|api_error|timeout|ECONNRESET|fetch failed|50\d\b|529/i


/**
 * Quantos turnos reprocessar por rodada.
 *
 * Cada um passa pelo debounce do `responderCliente` (20–30 s), e o cron tem
 * orçamento. Três por rodada, a cada 15 min, dá 12 por hora — mais que o
 * apagão de hoje inteiro, que foram 4.
 */
const MAX_POR_RODADA = 3
/** Depois disso a mensagem é velha demais: responder agora seria estranho. */
const JANELA_HORAS = 6

export type ResultadoReprocesso = {
  candidatos: number
  reprocessados: string[]
  pulados: Array<{ wamid: string; motivo: string }>
}

/**
 * Responde as mensagens que ficaram sem resposta por falha de API.
 *
 * NÃO reprocessa se a conversa já teve QUALQUER saída depois do turno que
 * falhou — nem do Luigi nem de gente. Responder por cima de alguém que já
 * atendeu é pior que o silêncio original: o cliente recebe duas conversas
 * diferentes ao mesmo tempo e uma delas ignora o que ele acabou de combinar.
 */
export async function reprocessarTurnosQueFalharam(): Promise<ResultadoReprocesso> {
  const saida: ResultadoReprocesso = { candidatos: 0, reprocessados: [], pulados: [] }
  const desde = new Date(Date.now() - JANELA_HORAS * 60 * 60_000).toISOString()

  // SÓ TURNO QUE NÃO CHEGOU A RODAR — `rodadas = 0`.
  //
  // `timeout` e `overloaded` pegam turno que JÁ executou ferramenta: pedido
  // criado, mockup gerado, resumo enviado, e só então a chamada seguinte
  // estourou. Reprocessar ali roda tudo de novo POR CIMA — segundo pedido,
  // segundo PDF. Saldo zerado morre na primeira chamada e é sempre rodadas 0,
  // que é exatamente o caso que esta tarefa existe pra cobrir. Qualquer turno
  // que chegou a rodar fica fora, sem exceção.
  const { data: falhas, error } = await supabaseAdmin
    .from('luigi_whatsapp_log')
    .select('id, conversa_id, wa_id, wamid_entrada, erro, criado_em')
    .eq('status', 'falhou')
    .eq('rodadas', 0)
    .gt('criado_em', desde)
    .not('wamid_entrada', 'is', null)
    .order('criado_em', { ascending: true })
    .limit(50)
  if (error) throw new Error(`reprocesso: ${error.message}`)

  const candidatos = (falhas ?? []).filter((f) => ERRO_DE_API.test((f as { erro: string | null }).erro ?? ''))
  saida.candidatos = candidatos.length

  for (const f of candidatos as Array<{ id: string; conversa_id: string; wa_id: string | null; wamid_entrada: string; erro: string | null; criado_em: string }>) {
    if (saida.reprocessados.length >= MAX_POR_RODADA) break
    // Sem número não há pra quem responder. Passar '' adiante faria o turno
    // rodar (e custar) pra ninguém, que é o tipo de falha silenciosa que a
    // gente passou a semana caçando.
    if (!f.wa_id) {
      saida.pulados.push({ wamid: f.wamid_entrada, motivo: 'turno sem wa_id' })
      continue
    }

    // Já foi atendida numa tentativa posterior? O próprio log diz: qualquer
    // linha mais nova pro mesmo wamid que não seja 'falhou' resolveu o turno.
    const { data: depois } = await supabaseAdmin
      .from('luigi_whatsapp_log')
      .select('status')
      .eq('wamid_entrada', f.wamid_entrada)
      .gt('criado_em', f.criado_em)
      .limit(5)
    if ((depois ?? []).some((l) => (l as { status: string | null }).status !== 'falhou')) {
      saida.pulados.push({ wamid: f.wamid_entrada, motivo: 'já respondida numa tentativa posterior' })
      continue
    }

    // Alguém falou depois — Luigi ou gente. Não escreve por cima.
    const { data: saiu } = await supabaseAdmin
      .from('wa_mensagens')
      .select('id')
      .eq('conversa_id', f.conversa_id)
      .eq('direcao', 'saida')
      .gt('criado_em', f.criado_em)
      .limit(1)
    if ((saiu ?? []).length > 0) {
      saida.pulados.push({ wamid: f.wamid_entrada, motivo: 'a conversa já teve saída depois' })
      continue
    }

    // A mensagem original, pra reconstruir o turno igual ao que chegou.
    const { data: msg } = await supabaseAdmin
      .from('wa_mensagens')
      .select('wamid, tipo, corpo, criado_em, conversa_id')
      .eq('wamid', f.wamid_entrada)
      .maybeSingle<{ wamid: string; tipo: string; corpo: string | null; criado_em: string; conversa_id: string }>()
    if (!msg) {
      saida.pulados.push({ wamid: f.wamid_entrada, motivo: 'mensagem original não encontrada' })
      continue
    }

    try {
      await responderCliente({
        conversaId: msg.conversa_id,
        waId: f.wa_id,
        nome: null,
        wamid: msg.wamid,
        criadoEm: msg.criado_em,
        tipo: msg.tipo,
        corpo: msg.corpo,
        semDebounce: true,
      })
      saida.reprocessados.push(f.wamid_entrada)
    } catch (err) {
      saida.pulados.push({ wamid: f.wamid_entrada, motivo: `falhou de novo: ${err instanceof Error ? err.message : String(err)}` })
    }
  }

  return saida
}

// ─── Alarmes de consumo ─────────────────────────────────────────────────────

const MICRO_POR_USD = 100_000

async function gastoDesde(iso: string): Promise<number> {
  const { data } = await supabaseAdmin.from('uso_ia').select('custo_micro').gt('criado_em', iso).limit(20_000)
  return (data ?? []).reduce((s, l) => s + ((l as { custo_micro: number | null }).custo_micro ?? 0), 0) / MICRO_POR_USD
}

export type ResultadoVigia = {
  gasto_hoje_usd: number
  teto_usd: number | null
  estourou_agora: boolean
  saldo_estimado_usd: number | null
  dias_restantes: number | null
  avisou: string[]
}

/**
 * Dois alarmes, os dois derivados de `uso_ia` — nenhum estado novo.
 *
 * TETO DIÁRIO pega o dia anômalo: em 10 dias medidos, $25 dispara só no 09/09
 * ($27,68, o incidente do agente de gestão) e em mais nenhum.
 *
 * SALDO ESTIMADO pega o que o teto NÃO pega, e é o caso real de hoje: a conta
 * zerou num dia de $3,25 — pico nenhum ia alcançar isso. O Fernando preenche
 * `saldo_recarga_usd` e `saldo_recarga_em` quando recarrega; o resto é conta.
 *
 * Os dois avisam na TRAVESSIA, comparando com o estado de 15 min atrás (o passo
 * do cron). Sem isso o alarme repetiria a cada rodada até o fim do dia, e é
 * assim que o Fernando para de ler aviso.
 */
export async function vigiarConsumoIa(): Promise<ResultadoVigia> {
  const saida: ResultadoVigia = {
    gasto_hoje_usd: 0, teto_usd: null, estourou_agora: false,
    saldo_estimado_usd: null, dias_restantes: null, avisou: [],
  }

  const { data: cfg } = await supabaseAdmin
    .from('agentes_config')
    .select('config')
    .eq('agente', 'luigi')
    .maybeSingle<{ config: Record<string, unknown> | null }>()
  const c = cfg?.config ?? {}
  const numero = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

  const inicioDoDia = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Recife' }))
  inicioDoDia.setHours(0, 0, 0, 0)
  const quinzeMin = new Date(Date.now() - 15 * 60_000).toISOString()

  const [hoje, ultimos15] = await Promise.all([gastoDesde(inicioDoDia.toISOString()), gastoDesde(quinzeMin)])
  saida.gasto_hoje_usd = Math.round(hoje * 100) / 100
  saida.teto_usd = numero(c.teto_diario_usd)

  if (saida.teto_usd != null && hoje > saida.teto_usd && hoje - ultimos15 <= saida.teto_usd) {
    saida.estourou_agora = true
    saida.avisou.push('teto diário')
    await avisarGestor(`Consumo de IA passou de US$ ${saida.teto_usd} hoje (está em US$ ${saida.gasto_hoje_usd.toFixed(2)}). Vale olhar o que está rodando em /admin.`)
  }

  const recarga = numero(c.saldo_recarga_usd)
  const recargaEm = typeof c.saldo_recarga_em === 'string' ? c.saldo_recarga_em : null
  if (recarga != null && recargaEm) {
    const gastoDaRecarga = await gastoDesde(recargaEm)
    const estimado = recarga - gastoDaRecarga
    const media7 = (await gastoDesde(new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString())) / 7
    saida.saldo_estimado_usd = Math.round(estimado * 100) / 100
    if (media7 > 0) {
      const dias = estimado / media7
      const diasAntes = (estimado + ultimos15) / media7
      saida.dias_restantes = Math.round(dias * 10) / 10
      if (dias < 2 && diasAntes >= 2) {
        saida.avisou.push('saldo estimado')
        await avisarGestor(
          `Saldo estimado da API: US$ ${saida.saldo_estimado_usd.toFixed(2)}, que na média dos últimos 7 dias ` +
            `(US$ ${media7.toFixed(2)}/dia) dá menos de 2 dias. Recarregue antes de zerar — em 09/09 e 15/09 ele zerou ` +
            `e o Luigi parou pra todo mundo.`
        )
      }
    }
  }

  return saida
}
