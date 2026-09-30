// app/lib/fechar-pedido-automatico.ts
// ============================================================================
// O FECHAMENTO NÃO DEPENDE MAIS DO LUIGI LEMBRAR — 10/09/2026.
//
// O pedido do Wesley (20260900282) é o caso que motivou este arquivo. Ele ficou
// PRONTO às 22:09: nome, e-mail, CEP, número, CPF, 5 macacões completos. Das
// 22:23 às 22:36 o Luigi anunciou quatro vezes que ia gerar as prévias e mandar
// o resumo. Gerou as cinco prévias às 22:33 — e mesmo assim o resumo não saiu, e
// o cliente recebeu no lugar dois relatórios de estado do próprio cadastro.
//
// A causa não é o prompt. É a forma do trabalho: "gerar 5 mockups e mandar o
// PDF" são seis chamadas de ferramenta, cada uma com uma imagem de IA no meio,
// dentro de um turno de 45 s que ainda precisa sobrar tempo pra escrever. O
// turno estoura, o modelo fecha com uma frase de intenção, e o "agora" nunca
// chega porque do lado do cliente estava tudo resolvido — ele não escreve de
// novo, e sem mensagem nova não existe próxima rodada.
//
// Nenhuma regra de prompt conserta isso: o modelo não está desobedecendo, está
// ficando sem turno. Então o fechamento sai da conversa e vira trabalho do
// sistema. Este módulo roda no cron, varre os pedidos que JÁ estão prontos e
// ainda não receberam o resumo, gera o que faltar de mockup e manda o PDF.
//
// O Luigi continua podendo mandar o resumo na hora, quando dá tempo — isto aqui
// é a rede embaixo: se ele conseguir, o `resumo_enviado_em` já está gravado e a
// varredura não faz nada; se não conseguir, no máximo quinze minutos depois o
// cliente recebe do mesmo jeito. É o que faz o fluxo ser invencível: o pior caso
// deixou de ser "não sai nunca" e passou a ser "sai um pouco depois".
//
// Segurança do que é enviado:
//   • só pedido que passa em `conferirPedido` — as mesmas travas de dados e de
//     peça que valem pra liberar pro fornecedor;
//   • só com a janela de 24 h aberta (PDF é mensagem livre, não template);
//   • `enviarResumoParaCliente` é idempotente: não remanda se o pedido não mudou;
//   • se alguém da casa escreveu na conversa nos últimos 15 min, pula a vez —
//     resumo automático não atropela atendimento humano em andamento.
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import { conferirPedido, enviarResumoParaCliente } from './pedido-fechamento'
import { faltaParaMockup, gerarMockupDoModelo, type LinhaMockup, type MapaMockups } from './mockup-pedido'
import { janela24hAberta } from './whatsapp-notify'
import { avisarGestor } from './luigi'
import { estaNaJanelaDoFechador, JANELA_FECHADOR_INICIO, JANELA_FECHADOR_FIM } from './horario'

/** Quantos pedidos uma rodada fecha. Cada mockup é uma imagem de IA: vai devagar. */
const PEDIDOS_POR_RODADA = 3

/** Idade máxima do pedido pra entrar na varredura. Acervo velho não se mexe sozinho. */
const IDADE_MAX_DIAS = 7

/**
 * Silêncio depois de alguém da casa falar — só o suficiente pra não atropelar
 * quem está digitando NESTE momento.
 *
 * Começou em 15 minutos e durou uma noite: o Fernando digitou "só um momento,
 * to gerando" às 22:36 pra segurar o cliente, e isso adiou o PDF que ele estava
 * justamente esperando. Quem tira o pedido do automático é a conversa estar
 * escalada, não o Fernando ter escrito uma linha de apoio.
 */
const RESPEITO_HUMANO_MS = 60_000

/**
 * Quantas rodadas seguidas o pedido espera por uma prévia que não sai.
 *
 * O cron roda de 15 em 15 min, então três rodadas são ~45 min. É a janela que
 * separa as duas falhas: erro passageiro (400 da API, crédito, timeout de
 * imagem) some sozinho na rodada seguinte; falha permanente naquele modelo não
 * some nunca, e aí segurar o resumo seria trocar "PDF com um modelo sem foto"
 * por "PDF que não chega".
 */
const MAX_ADIAMENTOS_PREVIA = 3

/** Prefixo estável do motivo — é por ele que a rodada seguinte se conta. */
const MOTIVO_PREVIA = 'prévia não saiu'

/**
 * Pode fechar pedido agora?
 *
 * Não é a mesma pergunta que "é horário comercial". Horário comercial protege
 * quem NÃO pediu nada de receber abordagem de madrugada. Aqui é o contrário:
 * tem alguém do outro lado que montou o pedido, respondeu tudo e está
 * esperando. Recusar às 21h05 de um sábado não protege ninguém — só atrasa.
 *
 * As regras, então:
 *   • 00h–07h59 nunca, em nenhuma hipótese. Madrugada é madrugada.
 *   • 08h–20h59 sempre, todo dia — inclusive fim de semana, porque pedido feito
 *     no sábado não tem por que esperar até segunda.
 *   • 21h–23h59 só se o cliente escreveu nas últimas 2 h. Aí ele está acordado,
 *     na conversa, esperando — o PDF é resposta, não interrupção.
 */
/** Cliente que escreveu há menos disto está em conversa; o fechador espera. */
const MINUTOS_CONVERSA_VIVA = 15

function podeFecharAgora(_ultimaEntradaDoCliente: Date | null): { pode: boolean; motivo: string } {
  // Janela própria, 8h–21h todo dia — o argumento está em horario.ts, junto
  // da constante. Em 27/09 ficou por um dia na janela geral (seg–sex 9h–11h)
  // e o Claude Code apontou a regressão do caso Wesley; o Fernando devolveu.
  return estaNaJanelaDoFechador()
    ? { pode: true, motivo: '' }
    : { pode: false, motivo: `fora da janela do fechador (${JANELA_FECHADOR_INICIO}h–${JANELA_FECHADOR_FIM}h)` }
}

export type ResultadoFechamento = {
  olhados: number
  /** `semImagem` lista os modelos (1-based, como o cliente vê) que foram sem prévia. */
  fechados: Array<{ pedido: string; mockupsGerados: number; semImagem?: number[] }>
  pulados: Array<{ pedido: string; motivo: string }>
}

type PedidoLinha = {
  id: string
  codigo: string | null
  telefone: string | null
  linhas: LinhaMockup[] | null
  mockups: MapaMockups | null
  previas_lote_em?: string | null
}

/** Já existe prévia de IA pra este modelo? */
function temMockupIa(mockups: MapaMockups | null, index: number): boolean {
  const mk = mockups?.[String(index)]
  return Array.isArray(mk?.ia) && mk.ia.length > 0
}

/**
 * Alguém da casa escreveu nesta conversa há pouco?
 *
 * `autor` nulo é mensagem digitada no inbox pelo Fernando — o Luigi grava com
 * a marca dele. Mesma leitura que a trava de "gente na conversa" usa.
 */
async function humanoFalouAgora(telefone: string): Promise<boolean> {
  const digitos = telefone.replace(/\D/g, '').slice(-8)
  if (digitos.length < 8) return false
  const desde = new Date(Date.now() - RESPEITO_HUMANO_MS).toISOString()
  const { data } = await supabaseAdmin
    .from('wa_mensagens')
    .select('id, autor, criado_em, conversa:wa_conversas!inner (contato:wa_contatos!inner (wa_id))')
    .eq('direcao', 'saida')
    .is('autor', null)
    .gte('criado_em', desde)
    .limit(20)
  type Linha = { conversa?: { contato?: { wa_id?: string } | Array<{ wa_id?: string }> } | Array<{ contato?: { wa_id?: string } | Array<{ wa_id?: string }> }> }
  for (const m of (data ?? []) as Linha[]) {
    const conv = Array.isArray(m.conversa) ? m.conversa[0] : m.conversa
    const cont = Array.isArray(conv?.contato) ? conv?.contato[0] : conv?.contato
    if (cont?.wa_id?.endsWith(digitos)) return true
  }
  return false
}

/**
 * A BOLA ESTÁ COM QUEM? — 29/09/2026 (Fernando: "Luigi meio fora de compasso").
 *
 * O fechador olhava só relógio: cliente calado há 15 min, ninguém da casa há
 * 60 s → manda o PDF. Duas vezes no mesmo dia isso saiu no momento errado:
 *   • Gabi, 18:04: "Ta tudo errado: esquece". O Luigi: "me conta o que ficou
 *     errado e a gente corrige". 18:31, o fechador: "Segue o resumo do seu
 *     pedido, posso liberar pras confecções?" — o resumo do pedido que ela
 *     acabou de dizer que está todo errado.
 *   • G., 18:44: o Fernando escreveu "posso te chamar amanhã cedo pra
 *     finalizar? vou precisar largar agora". 19:00, o fechador mandou o PDF.
 *
 * O fechador existe pro pedido PARADO: pronto, com a última fala nossa sendo
 * afirmação ("vou gerar as prévias e mandar o resumo") e ninguém esperando
 * nada de ninguém. Fica fora quando:
 *   • a última saída é de GENTE — a conversa está na mão do Fernando, e o que
 *     ele combinou ("amanhã") vale mais que o relógio;
 *   • a última fala do Luigi PEDE algo ao cliente (pergunta, "me passa", "me
 *     conta") — a bola está com o cliente, e PDF em cima de pergunta aberta é
 *     falar por cima de si mesmo;
 *   • a última mensagem do cliente é reclamação ou recuo ("errado", "esquece",
 *     "nada a ver", "cancela") — aí o pedido não está pronto, está em disputa,
 *     e quem resolve é conversa, não documento.
 */
const RECLAMACAO_DO_CLIENTE =
  /\b(errad[oa]s?|esquece|esquecer|deixa pra l[áa]|nada a ver|cancela|cancelar|desist|n[ãa]o (quero|é isso|era isso|foi isso)|n[ãa]o t[áa] certo|n[ãa]o est[áa] certo|tudo errado)\b/i
const LUIGI_PEDE_ALGO =
  /\?|\b(me (passa|manda|conta|diz|fala|envia|informa)|pode me (passar|mandar|dizer|falar)|qual (é|e|seria)|quais|quant[ao]s?|preciso (do|da|de|que)|s[óo] falta|falta (o|a|só)|confirma)\b/i

type UltimasFalas = { cliente: string | null; nossa: { corpo: string | null; autor: string | null } | null; ultimaEhNossa: boolean }

async function ultimasFalas(telefone: string): Promise<UltimasFalas | null> {
  const digitos = telefone.replace(/\D/g, '').slice(-8)
  if (digitos.length < 8) return null
  const { data: contatos } = await supabaseAdmin.from('wa_contatos').select('id').like('wa_id', `%${digitos}`)
  const ids = (contatos ?? []).map((c) => c.id as string)
  if (ids.length === 0) return null
  const { data: conversas } = await supabaseAdmin.from('wa_conversas').select('id').in('contato_id', ids)
  const convIds = (conversas ?? []).map((c) => c.id as string)
  if (convIds.length === 0) return null
  const { data } = await supabaseAdmin
    .from('wa_mensagens')
    .select('direcao, corpo, autor, tipo, criado_em')
    .in('conversa_id', convIds)
    .order('criado_em', { ascending: false })
    .limit(12)
  const msgs = (data ?? []) as Array<{ direcao: string; corpo: string | null; autor: string | null; tipo: string; criado_em: string }>
  if (msgs.length === 0) return null
  const cliente = msgs.find((m) => m.direcao === 'entrada' && (m.corpo ?? '').trim())
  const nossa = msgs.find((m) => m.direcao === 'saida' && m.tipo !== 'document')
  return {
    cliente: cliente?.corpo ?? null,
    nossa: nossa ? { corpo: nossa.corpo, autor: nossa.autor } : null,
    ultimaEhNossa: msgs[0].direcao === 'saida',
  }
}

/** O cliente mandou PDF nesta conversa nos últimos 7 dias? */
async function clienteMandouPdf(telefone: string): Promise<boolean> {
  const digitos = telefone.replace(/\D/g, '').slice(-8)
  if (digitos.length < 8) return false
  const { data: contatos } = await supabaseAdmin.from('wa_contatos').select('id').like('wa_id', `%${digitos}`)
  const ids = (contatos ?? []).map((c) => c.id as string)
  if (ids.length === 0) return false
  const { data: conversas } = await supabaseAdmin.from('wa_conversas').select('id').in('contato_id', ids)
  const convIds = (conversas ?? []).map((c) => c.id as string)
  if (convIds.length === 0) return false
  const { data } = await supabaseAdmin
    .from('wa_mensagens')
    .select('id')
    .in('conversa_id', convIds)
    .eq('direcao', 'entrada')
    .eq('tipo', 'document')
    .ilike('midia_mime', '%pdf%')
    .gte('criado_em', new Date(Date.now() - 7 * 86400_000).toISOString())
    .limit(1)
  return (data ?? []).length > 0
}

/** Por que o fechador não deve entrar agora — ou null se pode. Puro, pra teste. */
export function motivoParaFicarFora(f: UltimasFalas | null): string | null {
  if (!f) return null
  const autorNossa = (f.nossa?.autor ?? '').trim().toLowerCase()
  const nossaEhDeGente = Boolean(f.nossa) && autorNossa !== 'luigi' && autorNossa !== 'gestao'
  if (f.ultimaEhNossa && nossaEhDeGente) return 'a última fala é de gente da casa — a conversa está com o Fernando'
  // A oferta do resumo ("posso te mandar o resumo?") é a exceção: o PDF é
  // exatamente o que foi oferecido, e a legenda dele já pede a confirmação.
  const ehOfertaDoResumo = Boolean(f.nossa?.corpo) && /\b(mand[oa]r?|envi[oa]r?)\b[^?]{0,40}\bresumo\b/i.test(f.nossa?.corpo ?? '')
  if (f.ultimaEhNossa && f.nossa?.corpo && !ehOfertaDoResumo && LUIGI_PEDE_ALGO.test(f.nossa.corpo)) return 'a última fala do Luigi pede algo ao cliente — a bola está com ele'
  if (f.cliente && RECLAMACAO_DO_CLIENTE.test(f.cliente)) return `o cliente reclamou ou recuou ("${f.cliente.slice(0, 60)}") — resolve na conversa, não com PDF`
  return null
}

/** Quando o cliente falou pela última vez — o sinal de "está acordado, esperando". */
async function ultimaFalaDoCliente(telefone: string): Promise<Date | null> {
  const digitos = telefone.replace(/\D/g, '').slice(-8)
  if (digitos.length < 8) return null
  const { data: contatos } = await supabaseAdmin.from('wa_contatos').select('id').like('wa_id', `%${digitos}`)
  const ids = (contatos ?? []).map((c) => c.id as string)
  if (ids.length === 0) return null
  const { data: conversas } = await supabaseAdmin.from('wa_conversas').select('ultima_msg_contato_em').in('contato_id', ids)
  const datas = (conversas ?? [])
    .map((c) => (c as { ultima_msg_contato_em: string | null }).ultima_msg_contato_em)
    .filter((d): d is string => Boolean(d))
    .map((d) => new Date(d).getTime())
  return datas.length > 0 ? new Date(Math.max(...datas)) : null
}

/**
 * Gera as prévias que faltam pra este pedido.
 *
 * Modelo que ainda não tem dado suficiente (`faltaParaMockup` não vazio) é
 * pulado sem erro: mockup de peça "a combinar" seria invenção, e o resumo sai
 * melhor com quatro prévias boas do que com cinco, uma delas fantasiada.
 */
type Previas = { gerados: number; falharam: Array<{ index: number; motivo: string }> }

async function gerarMockupsQueFaltam(p: PedidoLinha): Promise<Previas> {
  const linhas = Array.isArray(p.linhas) ? p.linhas : []
  const r: Previas = { gerados: 0, falharam: [] }
  for (const [i, linha] of linhas.entries()) {
    if (temMockupIa(p.mockups, i)) continue
    // A foto do cliente vale como visualizador quando ele decidiu isso — e
    // também enquanto não decidiu: o fechador não inventa prévia por cima da
    // imagem que ele mesmo mandou (29/09/2026, Gleicy).
    const mk = p.mockups?.[String(i)]
    if (mk?.previa === 'cliente' || (mk?.previa !== 'gerar' && (mk?.fotos?.length ?? 0) > 0)) continue
    // Peça incompleta não é falha: não há o que ilustrar, e o `conferirPedido`
    // já barrou o pedido antes se isso importasse pra liberar.
    if (faltaParaMockup(linha, p.mockups?.[String(i)]).length > 0) continue
    try {
      const g = await gerarMockupDoModelo({ pedidoId: p.id, index: i })
      if (g.ok) r.gerados++
      // Prévia reprovada entra como FALHA, não como gerada: a imagem não foi
      // guardada e a peça continua sem prévia. Assim ela cai no adiamento com
      // teto que já existe aqui, em vez de o pedido fechar com um modelo
      // ilustrado errado — o caminho que vaza pro PDF e pra confecção sem
      // ninguém revisar.
      else if (g.tipo === 'reprovado')
        r.falharam.push({ index: i, motivo: `prévia não confere com o pedido: ${g.divergencias.join('; ')}` })
      else r.falharam.push({ index: i, motivo: ('erro' in g ? g.erro : g.motivo) ?? 'sem motivo' })
    } catch (err) {
      r.falharam.push({ index: i, motivo: err instanceof Error ? err.message : String(err) })
    }
  }
  return r
}

/**
 * Quantas rodadas seguidas este pedido já foi adiado por prévia que não saiu.
 *
 * Lê o próprio rastro: `fechamento_automatico_log` já guarda o motivo de cada
 * pulado, então o contador não precisa de coluna nova em `pedidos_assistente`.
 * Conta só o prefixo corrido mais recente — pedido que fechou e voltou (não
 * acontece hoje, mas o código não deve depender disso) recomeça do zero.
 *
 * Se a leitura falhar, devolve 0 e o pedido espera mais uma rodada. É a direção
 * segura: o erro aqui não pode virar um resumo incompleto enviado cedo demais.
 * Se o log estiver inacessível de vez, o `gravarRodada` também está falhando e
 * o problema é maior que este contador.
 */
async function adiamentosPorPrevia(rotulo: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('fechamento_automatico_log')
    .select('pulados')
    .order('criado_em', { ascending: false })
    .limit(MAX_ADIAMENTOS_PREVIA)
  if (error || !data) return 0
  let seguidas = 0
  for (const linha of data as Array<{ pulados: Array<{ pedido: string; motivo: string }> | null }>) {
    const lista = Array.isArray(linha.pulados) ? linha.pulados : []
    const este = lista.find((x) => x.pedido === rotulo)
    if (!este || !este.motivo.startsWith(MOTIVO_PREVIA)) break
    seguidas++
  }
  return seguidas
}

/**
 * Varre os pedidos prontos e sem resumo, e fecha o que der.
 *
 * Vem do mais novo pro mais velho: quem acabou de montar o pedido está com a
 * conversa aberta esperando, e é quem mais sente o atraso.
 */
export async function fecharPedidosProntos(): Promise<ResultadoFechamento> {
  const inicio = Date.now()
  const saida: ResultadoFechamento = { olhados: 0, fechados: [], pulados: [] }
  try {
    const r = await varrer(saida)
    await gravarRodada(saida, null, Date.now() - inicio)
    return r
  } catch (err) {
    const erro = err instanceof Error ? err.message : String(err)
    await gravarRodada(saida, erro, Date.now() - inicio)
    throw err
  }
}

/**
 * O RASTRO — 10/09/2026.
 *
 * Os logs de runtime deste projeto só registram a linha do request: nenhum
 * `console.log` aparece neles. Escrevi a primeira versão desta varredura
 * confiando em `console.warn` e no JSON de resposta do cron, e o resultado foi
 * uma noite inteira perguntando ao Fernando "roda esse curl e me manda a saída"
 * pra descobrir por que um pedido não fechou. O motivo existia — só que num
 * lugar que ninguém lê depois do fato.
 *
 * O banco é o canal que a gente enxerga. Uma linha por rodada resolve: na
 * próxima vez que um pedido for pulado em silêncio, o silêncio é consultável.
 */
async function gravarRodada(s: ResultadoFechamento, erro: string | null, duracaoMs: number): Promise<void> {
  try {
    await supabaseAdmin.from('fechamento_automatico_log').insert({
      olhados: s.olhados,
      fechados: s.fechados,
      pulados: s.pulados,
      erro,
      duracao_ms: duracaoMs,
    })
  } catch (err) {
    console.error('[fechar-pedido] não consegui gravar o rastro', { err })
  }
}

async function varrer(saida: ResultadoFechamento): Promise<ResultadoFechamento> {
  const desde = new Date(Date.now() - IDADE_MAX_DIAS * 86400_000).toISOString()

  const { data, error } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, codigo, telefone, linhas, mockups, previas_lote_em')
    .is('resumo_enviado_em', null)
    .not('telefone', 'is', null)
    .neq('status', 'cancelado')
    .gte('criado_em', desde)
    .order('criado_em', { ascending: false })
    .limit(30)
  if (error) {
    // NÃO devolve `saida` vazia aqui. Devolver transformaria uma consulta que
    // falhou numa rodada que "olhou 0 pedidos e não teve erro" — e é exatamente
    // esse `?? []` silencioso que fez a gente caçar o problema no lugar errado.
    // Estourar faz `fecharPedidosProntos` gravar a linha com o erro preenchido,
    // que é o único canal que a gente enxerga depois do fato.
    throw new Error(`consulta de pedidos falhou: ${error.message}`)
  }

  const pedidos = (data ?? []) as PedidoLinha[]
  saida.olhados = pedidos.length

  for (const p of pedidos) {
    if (saida.fechados.length >= PEDIDOS_POR_RODADA) break
    const rotulo = p.codigo ?? p.id.slice(0, 8)

    // A mesma conferência que vale pra liberar: dados do cliente e peças.
    // Pedido em montagem não é caso deste cron — mas o motivo fica registrado,
    // senão "não fechou" e "nem foi olhado" viram a mesma coisa no rastro.
    const pronto = await conferirPedido(p.id)
    if (!pronto.pronto) {
      saida.pulados.push({ pedido: rotulo, motivo: `ainda em montagem: ${pronto.falta}` })
      continue
    }

    if (!p.telefone || !(await janela24hAberta(p.telefone))) {
      saida.pulados.push({ pedido: rotulo, motivo: 'janela de 24h fechada' })
      continue
    }

    const ultimaFala = await ultimaFalaDoCliente(p.telefone)
    const quando = podeFecharAgora(ultimaFala)
    if (!quando.pode) {
      saida.pulados.push({ pedido: rotulo, motivo: quando.motivo })
      continue
    }
    // CONVERSA VIVA É DO LUIGI, NÃO DO FECHADOR — 27/09/2026.
    //
    // O Guilherme disse "sim, por favor" ao "posso mandar o resumo?" às
    // 14:14:21; o Luigi abriu o turno e mandou o PDF às 14:15:32. Esta rodada
    // começou às 14:15:06, leu `resumo_enviado_em` nulo (o Luigi ainda estava
    // gerando), gerou uma prévia por conta e mandou o MESMO PDF às 14:15:32,
    // 109 ms depois do dele. Dois arquivos iguais na tela do cliente.
    //
    // O fechador existe pro pedido PARADO — pronto e sem ninguém falando. Quem
    // escreveu há minutos está sendo atendido; entrar aqui é falar por cima.
    // A trava atômica em enviarResumoParaCliente é a rede pro caso extremo;
    // esta é a regra de bom senso que evita chegar lá.
    if (ultimaFala && Date.now() - ultimaFala.getTime() < MINUTOS_CONVERSA_VIVA * 60_000) {
      saida.pulados.push({ pedido: rotulo, motivo: `cliente falou há menos de ${MINUTOS_CONVERSA_VIVA} min — a conversa é do Luigi` })
      continue
    }
    if (await humanoFalouAgora(p.telefone)) {
      saida.pulados.push({ pedido: rotulo, motivo: 'gente da casa na conversa agora' })
      continue
    }
    const fora = motivoParaFicarFora(await ultimasFalas(p.telefone))
    if (fora) {
      saida.pulados.push({ pedido: rotulo, motivo: fora })
      continue
    }
    // Lote de prévias em andamento (previas-lote.ts): o Luigi está mostrando
    // os modelos ao cliente agora; o resumo vem depois do fecho do lote.
    if (p.previas_lote_em) {
      saida.pulados.push({ pedido: rotulo, motivo: 'prévias em lote ainda saindo — a conversa é do Luigi' })
      continue
    }

    // PRÉVIA QUE FALHA NÃO FECHA O PEDIDO CALADA — 11/09/2026.
    //
    // Antes, erro ao gerar mockup caía num `console.warn` e o resumo saía assim
    // mesmo, com um modelo sem imagem. Como `resumo_enviado_em` marca o pedido
    // pra sempre, o pedido nunca mais voltava aqui: o buraco era permanente e
    // ninguém — nem o cliente, nem o Fernando — ficava sabendo. É a mesma
    // família do PDF que mostrava a prévia velha: entregar errado em silêncio.
    //
    // Agora o pedido espera. Quase toda falha aqui é passageira (400 da API,
    // crédito, timeout de imagem) e a rodada seguinte resolve de graça. O que
    // não pode é esperar pra sempre, então depois de MAX_ADIAMENTOS_PREVIA o
    // resumo sai do mesmo jeito — só que dizendo, no rastro e pro Fernando,
    // quais modelos foram sem foto.
    // Referência em PDF: sem prévia de IA (ver Contexto.referenciaEmPdf em
    // luigi.ts — a prévia da Gabi saiu "nada a ver" com o lookbook dela).
    const previas = (await clienteMandouPdf(p.telefone)) ? { gerados: 0, falharam: [] } : await gerarMockupsQueFaltam(p)
    if (previas.falharam.length > 0) {
      const modelos = previas.falharam.map((f) => f.index + 1)
      const adiado = await adiamentosPorPrevia(rotulo)
      if (adiado < MAX_ADIAMENTOS_PREVIA) {
        const porque = previas.falharam[0].motivo.slice(0, 120)
        saida.pulados.push({
          pedido: rotulo,
          motivo: `${MOTIVO_PREVIA} no(s) modelo(s) ${modelos.join(', ')} — adiando ${adiado + 1}/${MAX_ADIAMENTOS_PREVIA}: ${porque}`,
        })
        continue
      }
    }
    const semImagem = previas.falharam.map((f) => f.index + 1)

    const r = await enviarResumoParaCliente(p.id)
    if (r.ok && !r.jaEnviado) {
      saida.fechados.push({ pedido: rotulo, mockupsGerados: previas.gerados, ...(semImagem.length ? { semImagem } : {}) })
      const faltando = semImagem.length
        ? ` Atenção: o(s) modelo(s) ${semImagem.join(', ')} foram sem prévia depois de ${MAX_ADIAMENTOS_PREVIA} tentativas — motivo: ${previas.falharam[0].motivo.slice(0, 200)}`
        : ''
      void avisarGestor(`Fechei sozinho o pedido ${rotulo}: ${previas.gerados > 0 ? `${previas.gerados} prévia(s) gerada(s) e ` : ''}resumo enviado ao cliente.${faltando}`)
    } else {
      saida.pulados.push({ pedido: rotulo, motivo: r.erro ?? 'resumo não saiu' })
    }
  }

  return saida
}
