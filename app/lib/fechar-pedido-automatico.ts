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
import { horaEmRecife } from './horario'

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
function podeFecharAgora(ultimaEntradaDoCliente: Date | null): { pode: boolean; motivo: string } {
  const hora = horaEmRecife()
  if (hora < 8) return { pode: false, motivo: 'madrugada (fecha a partir das 8h)' }
  if (hora < 21) return { pode: true, motivo: '' }
  const ativo =
    ultimaEntradaDoCliente && Date.now() - ultimaEntradaDoCliente.getTime() < 2 * 60 * 60_000
  return ativo
    ? { pode: true, motivo: '' }
    : { pode: false, motivo: 'depois das 21h e cliente sem falar há mais de 2h' }
}

export type ResultadoFechamento = {
  olhados: number
  fechados: Array<{ pedido: string; mockupsGerados: number }>
  pulados: Array<{ pedido: string; motivo: string }>
}

type PedidoLinha = {
  id: string
  codigo: string | null
  telefone: string | null
  linhas: LinhaMockup[] | null
  mockups: MapaMockups | null
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
async function gerarMockupsQueFaltam(p: PedidoLinha): Promise<number> {
  const linhas = Array.isArray(p.linhas) ? p.linhas : []
  let gerados = 0
  for (const [i, linha] of linhas.entries()) {
    if (temMockupIa(p.mockups, i)) continue
    if (faltaParaMockup(linha, p.mockups?.[String(i)]).length > 0) continue
    try {
      const r = await gerarMockupDoModelo({ pedidoId: p.id, index: i })
      if (r.ok) gerados++
      else console.warn('[fechar-pedido] mockup não saiu', { pedido: p.codigo, index: i, motivo: 'erro' in r ? r.erro : r.motivo })
    } catch (err) {
      console.error('[fechar-pedido] mockup falhou', { pedido: p.codigo, index: i, err })
    }
  }
  return gerados
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
    .select('id, codigo, telefone, linhas, mockups')
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

    const quando = podeFecharAgora(await ultimaFalaDoCliente(p.telefone))
    if (!quando.pode) {
      saida.pulados.push({ pedido: rotulo, motivo: quando.motivo })
      continue
    }
    if (await humanoFalouAgora(p.telefone)) {
      saida.pulados.push({ pedido: rotulo, motivo: 'gente da casa na conversa agora' })
      continue
    }

    const mockupsGerados = await gerarMockupsQueFaltam(p)
    const r = await enviarResumoParaCliente(p.id)
    if (r.ok && !r.jaEnviado) {
      saida.fechados.push({ pedido: rotulo, mockupsGerados })
      void avisarGestor(`Fechei sozinho o pedido ${rotulo}: ${mockupsGerados > 0 ? `${mockupsGerados} prévia(s) gerada(s) e ` : ''}resumo enviado ao cliente.`)
    } else {
      saida.pulados.push({ pedido: rotulo, motivo: r.erro ?? 'resumo não saiu' })
    }
  }

  return saida
}
