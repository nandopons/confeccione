// app/lib/cutucada-pos-resumo.ts
// ============================================================================
// A PERGUNTA QUE FALTOU, UMA HORA DEPOIS — 10/09/2026
//
// O Luigi manda o resumo em PDF e pergunta se está tudo certo. Se o cliente
// não responde, acabou: o Luigi só existe quando alguém escreve pra ele. Não
// há "depois" na vida dele — a vez dele termina quando ele para de digitar.
//
// O resultado está no banco: 23 pedidos completos, peças definidas, parados
// esperando um "pode" que ninguém vai dizer. Alguns há semanas.
//
// Esta é a única parte do sistema que faz o Luigi falar sem ser chamado. Por
// isso ela é deliberadamente pequena:
//
//   • UMA vez por pedido (`cutucada_resumo_em`), nunca duas
//   • só se o cliente NÃO escreveu nada depois do resumo — se escreveu, o Luigi
//     já está atendendo e cutucar por cima seria a máquina ignorando a conversa
//   • só dentro da janela de 24h, em TEXTO LIVRE: é a mesma conversa
//     continuando, não um template de marketing começando outra
//   • só em horário decente — uma hora depois de um resumo enviado às 23h cai
//     na madrugada, e ninguém confirma pedido dormindo
//
// E ela pergunta a coisa CERTA. "Só falta clicar em Buscar fornecedor" era o
// que a régua antiga dizia — mas de 23 pedidos completos, só 2 tinham os dados
// de frete e nota. Aos outros 21 a gente pedia um clique que não resolveria
// nada. Aqui, quando falta dado, a cutucada pede o dado.
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import { enviarTexto, normalizarWaId } from './whatsapp-cloud'
import { janela24hAberta, registrarSaidaInbox } from './whatsapp-notify'
import { humanoConduzindoPorTelefone } from './luigi'

/** Hora local de Recife. Inline pra não arrastar o módulo de marketing junto. */
function horaEmRecife(agora = new Date()): number {
  return Number(
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Recife',
      hour: '2-digit',
      hour12: false,
    }).format(agora)
  )
}

/** Quanto tempo de silêncio antes de perguntar de novo. */
const HORAS_ATE_CUTUCAR = 1

/**
 * Depois disto o assunto esfriou e a cutucada vira estranheza — "posso
 * confirmar?" três dias depois soa como quem não estava prestando atenção.
 * Pedido parado além disso é problema de régua, não de conversa.
 */
const HORAS_LIMITE = 48

/** Horário em que é razoável puxar assunto sobre pedido. */
const HORA_MIN = 8
const HORA_MAX = 20

/** Teto por rodada: o cron roda a cada 15 min e isto não é disparo em massa. */
const MAX_POR_RODADA = 10

export type ResultadoCutucada = {
  enviadas: number
  puladas: number
  observacao?: string
}

type PedidoCutucada = {
  id: string
  codigo: string | null
  nome: string | null
  telefone: string | null
  email: string | null
  cep: string | null
  numero: string | null
  cpf_cnpj: string | null
  resumo_enviado_em: string
}

const vazio = (v: string | null | undefined) => !(v ?? '').trim()
const semDigitos = (v: string | null | undefined) => !(v ?? '').replace(/\D/g, '')

/**
 * O primeiro dado que falta pra este pedido poder ir pras confecções.
 *
 * Mesma ordem e mesmas palavras de `conferirPedido` e do contexto do Luigi —
 * se divergirem, a cutucada pede uma coisa e a ferramenta exige outra, e o
 * cliente responde duas vezes por culpa nossa.
 */
function primeiroDadoQueFalta(p: PedidoCutucada): string | null {
  if (vazio(p.nome)) return 'nome de quem recebe'
  if (vazio(p.email)) return 'e-mail'
  if (semDigitos(p.cep)) return 'CEP'
  if (vazio(p.numero)) return 'número da casa'
  if (semDigitos(p.cpf_cnpj)) return 'CNPJ (ou CPF)'
  return null
}

/**
 * A mensagem. Curta, direta, uma pergunta só — é o que o Fernando cobrou do
 * Luigi a conversa inteira, e vale mais ainda aqui: a pessoa não pediu esta
 * mensagem.
 */
function textoDaCutucada(p: PedidoCutucada): string {
  const primeiro = (p.nome ?? '').trim().split(/\s+/)[0]
  const ola = primeiro ? `Oi, ${primeiro}! ` : 'Oi! '
  const falta = primeiroDadoQueFalta(p)

  if (!falta) return `${ola}Posso confirmar seu pedido e mandar pras confecções?`

  if (falta === 'CNPJ (ou CPF)') {
    return `${ola}Pra fechar seu pedido falta só o CNPJ pra nota — ou o CPF, se for no seu nome mesmo. Me passa?`
  }
  return `${ola}Pra fechar seu pedido falta só o ${falta}. Me passa?`
}

/**
 * Roda a cutucada. Failure-soft: um envio que falha não derruba os outros.
 */
export async function rodarCutucadaPosResumo(): Promise<ResultadoCutucada> {
  const hora = horaEmRecife()
  if (hora < HORA_MIN || hora >= HORA_MAX) {
    return { enviadas: 0, puladas: 0, observacao: `fora do horário (${HORA_MIN}h–${HORA_MAX}h)` }
  }

  const agora = Date.now()
  const desde = new Date(agora - HORAS_LIMITE * 60 * 60 * 1000).toISOString()
  const ate = new Date(agora - HORAS_ATE_CUTUCAR * 60 * 60 * 1000).toISOString()

  const { data } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, codigo, nome, telefone, email, cep, numero, cpf_cnpj, resumo_enviado_em')
    .not('resumo_enviado_em', 'is', null)
    .gte('resumo_enviado_em', desde)
    .lte('resumo_enviado_em', ate)
    .is('cutucada_resumo_em', null)
    .is('confirmado_em', null)
    .is('encerrado_em', null)
    .neq('pagamento_status', 'pago')
    .or(`lembretes_pausados_ate.is.null,lembretes_pausados_ate.lt.${new Date().toISOString()}`)
    .limit(40)

  const pedidos = (data ?? []) as PedidoCutucada[]
  if (pedidos.length === 0) return { enviadas: 0, puladas: 0 }

  let enviadas = 0
  let puladas = 0

  for (const p of pedidos) {
    if (enviadas >= MAX_POR_RODADA) break
    if (!p.telefone) {
      puladas++
      continue
    }

    try {
      const waId = normalizarWaId(p.telefone)

      // O CLIENTE ESCREVEU DEPOIS DO RESUMO? Então o Luigi já está com ele, e
      // esta mensagem seria a empresa falando por cima da própria conversa.
      // Marcamos como cutucado pra não voltar aqui — quem conduz é o Luigi.
      //
      // Em duas consultas de propósito: filtro em embed aninhado do PostgREST
      // (`wa_conversas!inner(wa_id)` + `.eq('wa_conversas.wa_id', …)`) falha em
      // SILÊNCIO — devolve linhas sem aplicar o filtro. Aqui isso significaria
      // achar resposta de outra conversa e nunca cutucar ninguém.
      const conversaId = await acharConversa(waId)
      if (conversaId && (await clienteRespondeuDepois(conversaId, p.resumo_enviado_em))) {
        await marcarCutucado(p.id)
        puladas++
        continue
      }

      // Texto livre só existe dentro da janela. Fechada, não insistimos por
      // template: quem não respondeu ao resumo não precisa de marketing.
      if (!(await janela24hAberta(waId))) {
        puladas++
        continue
      }

      // GENTE FALANDO: A CUTUCADA NÃO SAI — 11/09/2026.
      //
      // Cutucada é o caso em que escrever por cima é mais gratuito: o cliente
      // está conversando com o Fernando e um cron entra no meio pra perguntar
      // se ele viu o resumo. A mesma trava da resposta, no caminho automático.
      const conduzindo = await humanoConduzindoPorTelefone(waId)
      if (conduzindo.conduzindo) {
        puladas++
        continue
      }

      const texto = textoDaCutucada(p)
      const r = await enviarTexto(waId, texto)
      if (!r.ok) {
        console.error('[cutucada] envio falhou', { pedido: p.codigo ?? p.id, erro: r.erro })
        puladas++
        continue
      }

      await marcarCutucado(p.id)
      await registrarSaidaInbox(waId, p.nome, r.wamid, texto, null, 'luigi')
      enviadas++
    } catch (err) {
      console.error('[cutucada] erro no pedido', { pedido: p.codigo ?? p.id, err })
      puladas++
    }
  }

  return { enviadas, puladas }
}

/**
 * A conversa do inbox deste número, tolerando o nono dígito.
 *
 * O mesmo telefone chega como 5581998496055 e 558198496055; comparar por
 * igualdade acharia "nenhuma conversa" e a cutucada sairia por cima de quem já
 * tinha respondido. Os últimos 8 dígitos são o que os dois formatos têm igual.
 */
async function acharConversa(waId: string): Promise<string | null> {
  const { data: exata } = await supabaseAdmin
    .from('wa_conversas')
    .select('id')
    .eq('wa_id', waId)
    .maybeSingle<{ id: string }>()
  if (exata?.id) return exata.id

  const { data } = await supabaseAdmin
    .from('wa_conversas')
    .select('id, wa_id')
    .ilike('wa_id', `%${waId.slice(-8)}`)
    .limit(2)
  return ((data ?? []) as Array<{ id: string }>)[0]?.id ?? null
}

async function clienteRespondeuDepois(conversaId: string, desde: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('wa_mensagens')
    .select('id')
    .eq('conversa_id', conversaId)
    .eq('direcao', 'entrada')
    .gt('criado_em', desde)
    .limit(1)
  return (data ?? []).length > 0
}

async function marcarCutucado(pedidoId: string): Promise<void> {
  await supabaseAdmin
    .from('pedidos_assistente')
    .update({ cutucada_resumo_em: new Date().toISOString() })
    .eq('id', pedidoId)
}
