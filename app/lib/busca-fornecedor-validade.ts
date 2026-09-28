// app/lib/busca-fornecedor-validade.ts
// ============================================================================
// A BUSCA DE CONFECÇÃO TEM PRAZO, E QUEM RENOVA É O CLIENTE — 25/09/2026
//
// Regra do Fernando, nas palavras dele: "pedido com mais de 7 dias sem
// fornecedor vale a pena o sistema falar com o cliente pra saber se ele segue
// com interesse em continuar a busca. Se ele não responder nada a gente
// pergunta de novo depois de 2 dias. Se não responder, cancela. Se responder,
// renova por mais 7 dias a validade."
//
// O que existia antes: a fila automática cortava em 30 dias e o pedido ficava
// no funil pra sempre, sem que ninguém perguntasse nada. Em 25/09 havia 12
// pedidos liberados e sem confecção, o mais velho de 09/09 — e a única forma
// de saber se o cliente ainda queria era o Fernando perguntar à mão.
//
// COMO É:
//   • `busca_valida_ate` nasce em liberarParaFornecedores = agora + 7 dias.
//     A fila automática só oferta enquanto isso está no futuro.
//   • Venceu sem confecção → pergunta 1 (`busca_perguntada_em`, vezes = 1).
//   • Cliente escreveu QUALQUER COISA depois da pergunta → renova: +7 dias
//     contados de agora, pergunta zerada. Quem conduz a conversa é o Luigi
//     (ele sabe da pergunta pelo contexto); se o cliente disser que não quer
//     mais, o Luigi encerra e o pedido some daqui sozinho.
//   • 2 dias sem resposta → pergunta 2 (vezes = 2).
//   • mais 2 dias sem resposta → encerra (`sumiu`, por `regua`) e cancela as
//     ofertas que ainda estivessem no ar.
//
// A PERGUNTA SAI EM TEXTO SE A JANELA DE 24 H ESTIVER ABERTA; se não, vai o
// template `duvida_pedido_*` ("Sobre seu pedido na Confeccione, posso tirar
// uma dúvida?"), que é UTILITY aprovado e fala do pedido dele. Quando ele
// responde, a janela abre e o Luigi faz a pergunta de verdade — o contexto
// dele diz o que perguntar. Pedido de 7 dias quase nunca tem janela aberta,
// então na prática o caminho normal é o template.
//
// Mesmas travas das outras réguas: horário decente, gente conduzindo não é
// atropelada, e envio que falha não derruba a rodada.
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import { enviarTemplate, enviarTexto, normalizarWaId } from './whatsapp-cloud'
import { acharConversaPorNumero, janela24hAberta, registrarSaidaInbox } from './whatsapp-notify'
import { humanoConduzindoPorTelefone } from './luigi'
import { encerrarPedido } from './etapas-pedido'
import { DIAS_DE_BUSCA } from './horario-comercial'
import { estaEmHorarioComercial, FORA_DA_JANELA } from './horario'

/** Dias de silêncio entre a pergunta e a repetição, e entre a repetição e o encerramento. */
export const DIAS_ENTRE_TOQUES = 2

// 10 → 20 em 28/09/2026: com a janela seg–sex 9h–11h o cron só roda duas
// vezes por dia (9:05 e 10:05). Com 10, os 37 vencidos do backfill levariam
// dois dias; com 20, um. Continua sendo uma pergunta por pessoa.
const MAX_POR_RODADA = 20

export type ResultadoBuscaVencida = {
  perguntados: string[]
  repetidos: string[]
  renovados: string[]
  encerrados: string[]
  /** Vencidos cuja conversa está com o Fernando — a régua não entra; ele decide. */
  escaladas: string[]
  pulados: number
  observacao?: string
}

export type PedidoBuscaVencida = {
  id: string
  codigo: string | null
  nome: string | null
  telefone: string | null
  busca_valida_ate: string
  busca_perguntada_em: string | null
  busca_perguntada_vezes: number
}

export type DecisaoBusca = 'perguntar' | 'repetir' | 'renovar' | 'encerrar' | 'esperar'

/**
 * O que fazer com um pedido vencido, dado se o cliente respondeu depois da
 * última pergunta. Pura, pra testar sem banco.
 */
export function decidirBusca(p: Pick<PedidoBuscaVencida, 'busca_perguntada_em' | 'busca_perguntada_vezes' | 'busca_valida_ate'>, clienteRespondeu: boolean, agora = Date.now()): DecisaoBusca {
  if (!perguntaDestaRodada(p)) return 'perguntar'
  if (clienteRespondeu) return 'renovar'
  const silencioMs = agora - new Date(p.busca_perguntada_em as string).getTime()
  if (silencioMs < DIAS_ENTRE_TOQUES * 24 * 60 * 60 * 1000) return 'esperar'
  return p.busca_perguntada_vezes >= 2 ? 'encerrar' : 'repetir'
}

/**
 * A pergunta gravada é desta rodada de vencimento?
 *
 * A KAREN — 27/09/2026. A renovação apagava `busca_perguntada_em`; ela
 * respondeu ao template às 17:18, o cron renovou às 18:05 e apagou a marca,
 * e quando o Luigi voltou à conversa às 20:09 não sabia mais que a gente
 * tinha perguntado — respondeu "boa tarde" falando de fotos. A marca agora
 * FICA (é o contexto do Luigi); o que muda é que ela só conta pra esta
 * rodada se for posterior ao início da validade atual. Renovou → a validade
 * começou de novo → a pergunta velha não vale como "já perguntei".
 */
export function perguntaDestaRodada(p: Pick<PedidoBuscaVencida, 'busca_perguntada_em' | 'busca_valida_ate'>): boolean {
  if (!p.busca_perguntada_em) return false
  const inicioDaRodada = new Date(p.busca_valida_ate).getTime() - DIAS_DE_BUSCA * 24 * 60 * 60 * 1000
  return new Date(p.busca_perguntada_em).getTime() >= inicioDaRodada
}

/** Texto da pergunta quando dá pra falar em texto livre (janela aberta). */
export function textoDaPergunta(p: Pick<PedidoBuscaVencida, 'nome' | 'codigo'>, vez: 1 | 2): string {
  const primeiro = (p.nome ?? '').trim().split(/\s+/)[0]
  const ola = primeiro ? `Oi, ${primeiro}! ` : 'Oi! '
  if (vez === 1) {
    return `${ola}Ainda não fechei confecção pro seu pedido${p.codigo ? ` ${p.codigo}` : ''}. Quer que eu continue procurando?`
  }
  return `${ola}Continuo procurando confecção pro seu pedido${p.codigo ? ` ${p.codigo}` : ''}? Se não tiver retorno, encerro a busca por aqui.`
}

/** Primeiro nome pro {{1}} do template; a Meta recusa parâmetro vazio. */
function primeiroNome(nome: string | null): string {
  return (nome ?? '').trim().split(/\s+/)[0] || 'cliente'
}

/**
 * O resumo que vai no {{2}} do template `pedido_atualizacao` — a pergunta em
 * si, sem quebra de linha (a Meta recusa), até 300 caracteres.
 *
 * NÃO É MAIS O `duvida_pedido_*` — 27/09/2026. Aquele template vem com o
 * botão "Falar com atendente": a Karen tocou nele às 17:18, a conversa
 * escalou pro Fernando (que não estava), o Luigi calou e ela ficou três horas
 * sem resposta — pra uma pergunta que era da máquina. O `pedido_atualizacao`
 * leva a pergunta no corpo e o botão abre o pedido; quem responde cai no
 * Luigi, que tem o contexto pra continuar.
 */
export function resumoDoTemplate(vez: 1 | 2): string {
  return vez === 1
    ? 'ainda não encontrei confecção pro seu pedido. Quer que eu continue procurando? Me responde por aqui'
    : 'continuo procurando confecção pro seu pedido? Se não tiver retorno, encerro a busca por aqui'
}

/** Corpo renderizado do template, pro histórico do inbox. */
function corpoDoTemplate(nome: string | null, vez: 1 | 2, pedidoId: string): string {
  return (
    `Oi, ${primeiroNome(nome)}! Atualização do seu pedido na Confeccione: ${resumoDoTemplate(vez)}. Toque no botão pra ver os detalhes e continuar por lá.\n` +
    `▸ Ver detalhes → https://www.confeccione.com.br/visualizador/${pedidoId}`
  )
}

export async function rodarBuscaVencida(): Promise<ResultadoBuscaVencida> {
  const vazio: ResultadoBuscaVencida = { perguntados: [], repetidos: [], renovados: [], encerrados: [], escaladas: [], pulados: 0 }
  if (!estaEmHorarioComercial()) return { ...vazio, observacao: FORA_DA_JANELA }

  const agoraIso = new Date().toISOString()

  // Quem ainda está procurando confecção, pela view (aceite de confecção tira
  // o pedido de `buscando`/`sem_fornecedor` sozinho). Os campos da régua vêm
  // da tabela — a view não os tem, e pedir à view coluna que ela não tem é
  // como a fila ficou 15 dias sem ofertar (ver oferta-automatica.ts).
  const { data: naBusca, error: e1 } = await supabaseAdmin
    .from('pedidos_assistente_etapas')
    .select('id')
    .in('etapa', ['buscando_fornecedor', 'sem_fornecedor'])
    .not('confirmado_em', 'is', null)
    .is('encerrado_em', null)
    .limit(200)
  if (e1) throw new Error(`busca vencida: pedidos na busca — ${e1.message}`)
  const ids = ((naBusca ?? []) as Array<{ id: string }>).map((p) => p.id)
  if (ids.length === 0) return vazio

  const { data, error: e2 } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, codigo, nome, telefone, busca_valida_ate, busca_perguntada_em, busca_perguntada_vezes')
    .in('id', ids)
    .lt('busca_valida_ate', agoraIso)
    // VENCIDO HÁ MAIS DE 30 DIAS NÃO ENTRA — 25/09/2026. No dia da migration o
    // backfill deixou 40 pedidos vencidos, 23 deles liberados em junho/julho.
    // "Posso tirar uma dúvida sobre seu pedido?" três meses depois não é
    // régua, é estranheza — e 40 templates de uma vez é disparo em massa. O
    // acervo antigo é decisão do Fernando (encerrar em lote, à mão); a régua
    // cuida do que venceu há pouco.
    .gte('busca_valida_ate', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .or('pagamento_status.is.null,pagamento_status.neq.pago')
    .or(`lembretes_pausados_ate.is.null,lembretes_pausados_ate.lt.${agoraIso}`)
    .order('busca_valida_ate', { ascending: true })
    .limit(60)
  if (e2) throw new Error(`busca vencida: pedidos vencidos — ${e2.message}`)
  const pedidos = (data ?? []) as PedidoBuscaVencida[]
  if (pedidos.length === 0) return vazio

  const r: ResultadoBuscaVencida = { ...vazio, perguntados: [], repetidos: [], renovados: [], encerrados: [], escaladas: [] }
  const rotuloDe = (p: PedidoBuscaVencida) => p.codigo ?? p.id
  let toques = 0

  for (const p of pedidos) {
    if (toques >= MAX_POR_RODADA) break
    try {
      if (!p.telefone) {
        r.pulados++
        continue
      }
      const waId = normalizarWaId(p.telefone)
      const conversa = await acharConversaPorNumero(waId)
      const conversaId = conversa?.id ?? null
      // CONVERSA ESCALADA NÃO RECEBE PERGUNTA DA MÁQUINA — 27/09/2026. O Dan
      // (TOY) estava "com o Fernando" desde uma escalada antiga; a régua mandou
      // o template, ele respondeu "Pode sim" às 16:06, o Luigi descartou a
      // resposta (conversa escalada) e ninguém respondeu. Quem está escalado
      // é assunto do Fernando: fica na lista de pulados com o motivo, e ele
      // decide à mão.
      if (conversa?.luigi_escalado_em) {
        r.escaladas.push(rotuloDe(p))
        r.pulados++
        continue
      }
      const respondeu = perguntaDestaRodada(p) && conversaId ? await clienteEscreveuDepois(conversaId, p.busca_perguntada_em as string) : false

      const decisao = decidirBusca(p, respondeu)
      const rotulo = p.codigo ?? p.id

      if (decisao === 'esperar') continue

      if (decisao === 'renovar') {
        await supabaseAdmin
          .from('pedidos_assistente')
          .update({
            busca_valida_ate: new Date(Date.now() + DIAS_DE_BUSCA * 24 * 60 * 60 * 1000).toISOString(),
            // A marca fica: é por ela que o Luigi sabe que perguntamos (ver
            // perguntaDestaRodada e o proximo_passo em luigi.ts).
            busca_perguntada_vezes: 0,
          })
          .eq('id', p.id)
        r.renovados.push(rotulo)
        continue
      }

      if (decisao === 'encerrar') {
        await encerrarPedido(p.id, 'sumiu', 'regua', `busca vencida: perguntamos 2 vezes se continuava e não respondeu`)
        await supabaseAdmin
          .from('ofertas_pedido_assistente')
          .update({ status: 'cancelada', respondido_em: agoraIso, observacao: 'pedido encerrado pela régua da busca' })
          .eq('pedido_id', p.id)
          .eq('status', 'ofertada')
        r.encerrados.push(rotulo)
        continue
      }

      // perguntar / repetir — envia.
      const conduzindo = await humanoConduzindoPorTelefone(waId)
      if (conduzindo.conduzindo) {
        r.pulados++
        continue
      }
      const vez: 1 | 2 = decisao === 'perguntar' ? 1 : 2
      let ok: { ok: true; wamid: string } | { ok: false; erro: string }
      let corpo: string
      let template: string | null = null
      if (await janela24hAberta(waId)) {
        corpo = textoDaPergunta(p, vez)
        ok = await enviarTexto(waId, corpo)
      } else {
        // Mesma chamada de avisoOficial (whatsapp-notify.ts): {{1}} nome, {{2}}
        // resumo, botão de URL com o caminho do pedido. Parâmetro vazio a Meta
        // recusa com 132000 — foi a primeira rodada real, 14:05 de 27/09.
        template = 'pedido_atualizacao'
        corpo = corpoDoTemplate(p.nome, vez, p.id)
        ok = await enviarTemplate(waId, template, 'pt_BR', [
          { type: 'body', parameters: [{ type: 'text', text: primeiroNome(p.nome) }, { type: 'text', text: resumoDoTemplate(vez) }] },
          { type: 'button', sub_type: 'url', index: 0, parameters: [{ type: 'text', text: `visualizador/${p.id}` }] },
        ])
      }
      if (!ok.ok) {
        console.error('[busca-vencida] envio falhou', { pedido: rotulo, erro: ok.erro })
        r.pulados++
        continue
      }
      await registrarSaidaInbox(waId, p.nome, ok.wamid, corpo, template, 'luigi')
      await supabaseAdmin
        .from('pedidos_assistente')
        .update({ busca_perguntada_em: new Date().toISOString(), busca_perguntada_vezes: vez })
        .eq('id', p.id)
      toques++
      if (vez === 1) r.perguntados.push(rotulo)
      else r.repetidos.push(rotulo)
    } catch (err) {
      console.error('[busca-vencida] erro no pedido', { pedido: p.codigo ?? p.id, err })
      r.pulados++
    }
  }

  return r
}

async function clienteEscreveuDepois(conversaId: string, desde: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('wa_mensagens')
    .select('id')
    .eq('conversa_id', conversaId)
    .eq('direcao', 'entrada')
    .gt('criado_em', desde)
    .limit(1)
  if (error) throw new Error(`busca vencida: resposta do cliente — ${error.message}`)
  return (data ?? []).length > 0
}
