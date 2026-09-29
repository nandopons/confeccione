// app/lib/cutucada-janela.ts
// ============================================================================
// "GOSTARIA DE CONCLUIR SEU PEDIDO?" — ANTES DE A JANELA DE 24 H FECHAR
// (29/09/2026, decisão do Fernando)
//
// O Icaro (20260900340) abriu o pedido no site sexta 21:53, conversou com o
// Luigi até 22:22 ("manda o valor logo"), parou — e ninguém voltou. A régua
// de pedido incompleto existe, mas é template (marketing) e só sai na janela
// 9h–11h de segunda a sexta; a janela de texto livre dele fechou sábado 22:22
// sem uma única tentativa. O Leandro (342, pedido completo, faltando o CNPJ)
// é o mesmo desenho: o Luigi perguntou, ele sumiu, a conversa esfriou.
//
// O Fernando: "deveria enviar mensagem antes de fechar a janela de 24 horas,
// pra concluir o pedido — pelo menos a primeira tentativa. 'Gostaria de
// concluir seu pedido?', bem simples."
//
// Regras, e por que cada uma:
//   • só pedido ABERTO em montagem (captado / pedido_completo sem resumo) —
//     depois do resumo é a cutucada-pos-resumo; depois de liberado é a régua
//     da busca
//   • só dentro da janela de 24 h, em TEXTO LIVRE: é a mesma conversa
//     continuando, não uma abordagem
//   • só se a última fala foi do Luigi (a bola parou com o cliente) e ele
//     está calado há pelo menos HORAS_DE_SILENCIO
//   • UMA vez por silêncio (`wa_conversas.cutucada_janela_em`): se ele
//     responder e sumir de novo, pode cutucar de novo; se não responder, não
//   • horário 8h–21h, todo dia (a mesma exceção do fechador): a janela de 24 h
//     não espera segunda-feira, e o cliente que escreveu sexta à noite tem a
//     janela fechando sábado à noite
//   • gente conduzindo, conversa escalada ou lembretes pausados → não
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import { enviarTexto, normalizarWaId } from './whatsapp-cloud'
import { acharConversaPorNumero, janela24hAberta, registrarSaidaInbox } from './whatsapp-notify'
import { humanoConduzindoPorTelefone } from './luigi'
import { estaNaJanelaDoFechador } from './horario'

/** Silêncio mínimo do cliente antes de perguntar. */
const HORAS_DE_SILENCIO = 3
/** Depois disto a janela de 24 h já fechou (ou está fechando) — não tem como. */
const HORAS_MAX = 23
const MAX_POR_RODADA = 10

export type ResultadoCutucadaJanela = { enviadas: number; puladas: number; observacao?: string }

type Pedido = {
  id: string
  codigo: string | null
  nome: string | null
  telefone: string | null
  etapa: string
}

export function textoDaCutucadaJanela(nome: string | null): string {
  const primeiro = (nome ?? '').trim().split(/\s+/)[0]
  return `${primeiro ? `Oi, ${primeiro}! ` : 'Oi! '}Gostaria de concluir seu pedido? É só me responder por aqui que a gente continua de onde parou.`
}

export async function rodarCutucadaJanela(): Promise<ResultadoCutucadaJanela> {
  if (!estaNaJanelaDoFechador()) return { enviadas: 0, puladas: 0, observacao: 'fora das 8h–21h' }

  const agora = Date.now()
  const { data, error } = await supabaseAdmin
    .from('pedidos_assistente_etapas')
    .select('id, codigo, nome, telefone, etapa')
    .in('etapa', ['captado', 'pedido_completo'])
    .not('telefone', 'is', null)
    // Tocado nas últimas 30 h (pedido ou WhatsApp): fora disso a janela já
    // fechou de qualquer jeito.
    .gte('ultimo_toque_em', new Date(agora - 30 * 60 * 60 * 1000).toISOString())
    .limit(60)
  if (error) throw new Error(`cutucada janela: pedidos — ${error.message}`)
  const pedidos = (data ?? []) as Pedido[]
  if (pedidos.length === 0) return { enviadas: 0, puladas: 0 }

  // Resumo já enviado / lembretes pausados vêm da tabela (a view não traz).
  const { data: extras, error: e2 } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, resumo_enviado_em, lembretes_pausados_ate')
    .in('id', pedidos.map((p) => p.id))
  if (e2) throw new Error(`cutucada janela: extras — ${e2.message}`)
  const extra = new Map(((extras ?? []) as Array<{ id: string; resumo_enviado_em: string | null; lembretes_pausados_ate: string | null }>).map((x) => [x.id, x]))

  let enviadas = 0
  let puladas = 0
  const jaVistos = new Set<string>()

  for (const p of pedidos) {
    if (enviadas >= MAX_POR_RODADA) break
    const x = extra.get(p.id)
    if (x?.resumo_enviado_em) continue // é da cutucada-pos-resumo
    if (x?.lembretes_pausados_ate && new Date(x.lembretes_pausados_ate).getTime() > agora) continue
    if (!p.telefone) continue

    try {
      const waId = normalizarWaId(p.telefone)
      if (jaVistos.has(waId)) continue
      jaVistos.add(waId)

      const conversa = await acharConversaPorNumero(waId)
      if (!conversa || conversa.luigi_escalado_em) {
        puladas++
        continue
      }
      const { data: c, error: e3 } = await supabaseAdmin
        .from('wa_conversas')
        .select('ultima_msg_contato_em, cutucada_janela_em')
        .eq('id', conversa.id)
        .maybeSingle<{ ultima_msg_contato_em: string | null; cutucada_janela_em: string | null }>()
      if (e3 || !c?.ultima_msg_contato_em) {
        puladas++
        continue
      }
      const silencioMs = agora - new Date(c.ultima_msg_contato_em).getTime()
      if (silencioMs < HORAS_DE_SILENCIO * 3600_000 || silencioMs > HORAS_MAX * 3600_000) {
        puladas++
        continue
      }
      // Uma por silêncio: já cutucou depois da última fala dele → não repete.
      if (c.cutucada_janela_em && new Date(c.cutucada_janela_em).getTime() > new Date(c.ultima_msg_contato_em).getTime()) {
        puladas++
        continue
      }
      // A bola tem que estar com ele: última mensagem da conversa é nossa e do
      // Luigi. Se a última foi da equipe, é o Fernando conduzindo; se foi
      // dele, o Luigi ainda deve resposta (outro problema, não este).
      const { data: ult } = await supabaseAdmin
        .from('wa_mensagens')
        .select('direcao, autor')
        .eq('conversa_id', conversa.id)
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle<{ direcao: string; autor: string | null }>()
      if (!ult || ult.direcao !== 'saida' || (ult.autor ?? 'luigi') !== 'luigi') {
        puladas++
        continue
      }
      if (!(await janela24hAberta(waId))) {
        puladas++
        continue
      }
      if ((await humanoConduzindoPorTelefone(waId)).conduzindo) {
        puladas++
        continue
      }

      const texto = textoDaCutucadaJanela(p.nome)
      const r = await enviarTexto(waId, texto)
      if (!r.ok) {
        console.error('[cutucada-janela] envio falhou', { pedido: p.codigo ?? p.id, erro: r.erro })
        puladas++
        continue
      }
      await supabaseAdmin.from('wa_conversas').update({ cutucada_janela_em: new Date().toISOString() }).eq('id', conversa.id)
      await registrarSaidaInbox(waId, p.nome, r.wamid, texto, null, 'luigi')
      enviadas++
    } catch (err) {
      console.error('[cutucada-janela] erro no pedido', { pedido: p.codigo ?? p.id, err })
      puladas++
    }
  }
  return { enviadas, puladas }
}
