// app/lib/previas-lote.ts
// ============================================================================
// PRÉVIAS EM LOTE — 29/09/2026 (decisão do Fernando).
//
// "Melhor gerar as prévias tudo de uma vez e colocar Modelo 1, Modelo 2 nas
// legendas. Se o cliente tiver algum ajuste ele diz: ajusta tal coisa no
// modelo 3."
//
// Até hoje era um modelo por turno: imagem, "está bom?", o cliente diz "sim",
// e só aí o próximo — cada "sim" custando uma rodada inteira do Luigi (o
// prompt de contexto tem dezenas de milhares de tokens). Cinco modelos eram
// cinco turnos, e no meio deles o modelo escrevia coisas como "seguindo para o
// Modelo 3, gerei a prévia, está bom?" (Guilherme, 20:22). Agora o Luigi PEDE o
// lote uma vez e sai da frente: quem gera e manda é código, na ordem, cada
// imagem com a legenda "Modelo N (peça, cor)". O que não couber no orçamento
// de tempo do turno, o cron de 1 minuto termina. No fim vai UMA linha de fecho,
// por código, com a pergunta do resumo — o "sim" dela já é lido pelo
// liberarSeEleConfirmou/resumo-por-código de sempre.
//
// O ajuste continua por modelo: "a logo maior no 3" → gerar_mockup_do_modelo
// com `instrucoes`, que refaz só aquele e manda com "refiz o visualizador".
//
// Concorrência: o turno e o cron podem querer o mesmo lote. A vez é um UPDATE
// condicional em `previas_lote_rodando_em` (mesmo desenho de tomarAVez em
// luigi.ts); quem não escreveu a linha sai sem gerar nada.
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import { faltaParaMockup, gerarMockupDoModelo, type LinhaMockup, type MapaMockups } from './mockup-pedido'
import { enviarImagemDoPedido, registrarSaidaInbox } from './whatsapp-notify'
import { enviarTexto } from './whatsapp-cloud'

/** Lote que não terminou em tanto tempo fecha com o que tem (provedor fora, etc.). */
const LOTE_DESISTE_MS = 20 * 60_000
/** Vez que ficou presa (função morreu no meio) expira sozinha. */
const VEZ_EXPIRA_MS = 4 * 60_000

/**
 * O fecho do lote. A segunda frase TEM que casar com PERGUNTA_DO_RESUMO em
 * luigi.ts ("posso … resumo …?"): é assim que o "sim" dela vira PDF por código
 * sem passar pelo modelo.
 */
export const FECHO_DO_LOTE =
  'Essas são as prévias de todos os modelos. Se quiser ajustar algum, me diz qual modelo e o que muda. ' +
  'Se estiver tudo certo, posso te mandar o resumo do pedido?'

type PedidoLote = {
  id: string
  codigo: string | null
  telefone: string | null
  nome: string | null
  linhas: LinhaMockup[] | null
  mockups: MapaMockups | null
  previas_lote_em: string | null
}

export type ResultadoLote = {
  /** Imagens que saíram NESTA rodada. */
  enviadas: number
  /** Modelos que ainda não têm prévia e ainda dá pra gerar (ficaram pro cron). */
  restantes: number
  /** O lote terminou (fecho enviado ou nada mais a fazer). */
  concluido: boolean
  motivo?: string
}

function temPrevia(mockups: MapaMockups | null, i: number): boolean {
  const mk = mockups?.[String(i)]
  return Array.isArray(mk?.ia) && mk.ia.length > 0
}

/** "Modelo 2 (camiseta oversized, preto)" — a cor entra quando o nome se repete no pedido. */
export function legendaDaPrevia(linhas: LinhaMockup[], i: number): string {
  const l = linhas[i]
  const nome = (l?.modelo ?? '').trim() || 'peça'
  const repetido = linhas.filter((x) => (x?.modelo ?? '').trim().toLowerCase() === nome.toLowerCase()).length > 1
  const cor = (l?.cor ?? '').trim()
  const rotulo = repetido && cor ? `${nome}, ${cor}` : nome
  return linhas.length > 1 ? `Modelo ${i + 1} (${rotulo})` : rotulo.charAt(0).toUpperCase() + rotulo.slice(1)
}

/** Índices (0-based) sem prévia e com dado suficiente pra gerar. */
export function modelosQueFaltam(linhas: LinhaMockup[], mockups: MapaMockups | null): number[] {
  const out: number[] = []
  linhas.forEach((l, i) => {
    if (temPrevia(mockups, i)) return
    // A foto dele é o visualizador (decisão dele): não gera.
    if (mockups?.[String(i)]?.previa === 'cliente') return
    if (faltaParaMockup(l, mockups?.[String(i)]).length > 0) return
    out.push(i)
  })
  return out
}

async function tomarAVez(pedidoId: string): Promise<boolean> {
  const agora = new Date()
  const { data, error } = await supabaseAdmin
    .from('pedidos_assistente')
    .update({ previas_lote_rodando_em: agora.toISOString() })
    .eq('id', pedidoId)
    .or(`previas_lote_rodando_em.is.null,previas_lote_rodando_em.lt.${new Date(agora.getTime() - VEZ_EXPIRA_MS).toISOString()}`)
    .select('id')
  if (error) return false
  return (data ?? []).length > 0
}

async function soltarAVez(pedidoId: string): Promise<void> {
  await supabaseAdmin.from('pedidos_assistente').update({ previas_lote_rodando_em: null }).eq('id', pedidoId)
}

/** Marca o pedido pra ter as prévias geradas em lote (idempotente). */
export async function pedirLotePrevias(pedidoId: string): Promise<void> {
  await supabaseAdmin
    .from('pedidos_assistente')
    .update({ previas_lote_em: new Date().toISOString() })
    .eq('id', pedidoId)
    .is('previas_lote_em', null)
}

/**
 * Gera e manda as prévias que faltam, uma por uma, até acabar ou até estourar
 * `orcamentoMs`. Termina o lote (fecho + limpa a marca) quando não sobra nada
 * gerável. Chamada pela ferramenta do Luigi (dentro do turno) e pelo cron de 1
 * minuto (o que sobrou).
 */
export async function rodarLotePrevias(pedidoId: string, orcamentoMs: number): Promise<ResultadoLote> {
  const inicio = Date.now()
  if (!(await tomarAVez(pedidoId))) return { enviadas: 0, restantes: 0, concluido: false, motivo: 'outro processo está gerando este lote' }
  try {
    const { data: p } = await supabaseAdmin
      .from('pedidos_assistente')
      .select('id, codigo, telefone, nome, linhas, mockups, previas_lote_em')
      .eq('id', pedidoId)
      .maybeSingle<PedidoLote>()
    if (!p) return { enviadas: 0, restantes: 0, concluido: true, motivo: 'pedido não encontrado' }
    if (!p.previas_lote_em) return { enviadas: 0, restantes: 0, concluido: true, motivo: 'lote não pedido' }
    if (!p.telefone) {
      await concluir(p.id)
      return { enviadas: 0, restantes: 0, concluido: true, motivo: 'pedido sem telefone' }
    }

    const linhas = Array.isArray(p.linhas) ? p.linhas : []
    let mockups: MapaMockups | null = p.mockups
    let enviadas = 0
    const falharam: number[] = []
    const desistir = Date.now() - new Date(p.previas_lote_em).getTime() > LOTE_DESISTE_MS

    for (const i of modelosQueFaltam(linhas, mockups)) {
      if (Date.now() - inicio > orcamentoMs) break
      if (desistir) break
      let r: Awaited<ReturnType<typeof gerarMockupDoModelo>>
      try {
        r = await gerarMockupDoModelo({ pedidoId: p.id, index: i })
      } catch (err) {
        falharam.push(i)
        console.error('[previas-lote] geração estourou', { pedido: p.codigo, modelo: i + 1, err })
        continue
      }
      if (!r.ok) {
        // Provedor fora: não adianta insistir agora; o cron volta em 1 min.
        if (r.tipo === 'indisponivel') {
          await soltarAVez(p.id)
          return { enviadas, restantes: modelosQueFaltam(linhas, mockups).length, concluido: false, motivo: `provedor de imagem indisponível (${r.motivo})` }
        }
        falharam.push(i)
        continue
      }
      // Relê os mockups: a geração gravou a imagem no pedido.
      const { data: agora } = await supabaseAdmin.from('pedidos_assistente').select('mockups').eq('id', p.id).maybeSingle<{ mockups: MapaMockups | null }>()
      mockups = agora?.mockups ?? mockups
      const imagem = r.ia[r.ia.length - 1]
      if (!imagem) continue
      const envio = await enviarImagemDoPedido({
        waId: p.telefone,
        nome: p.nome,
        pedidoId: p.id,
        ref: imagem.url,
        legenda: legendaDaPrevia(linhas, i),
        autor: 'luigi',
      })
      if (envio.ok) enviadas++
      else console.error('[previas-lote] envio da prévia falhou', { pedido: p.codigo, modelo: i + 1, erro: envio.erro })
    }

    // O que sobrou é só o que ainda dá pra gerar e não falhou nesta rodada.
    const restantes = modelosQueFaltam(linhas, mockups).filter((i) => !falharam.includes(i))
    if (restantes.length > 0 && !desistir) {
      await soltarAVez(p.id)
      return { enviadas, restantes: restantes.length, concluido: false }
    }

    // Acabou (ou desistiu): fecha com uma linha só, e a marca some.
    const algumaPrevia = linhas.some((_, i) => temPrevia(mockups, i))
    if (algumaPrevia) {
      const r = await enviarTexto(p.telefone, FECHO_DO_LOTE)
      if (r.ok) await registrarSaidaInbox(p.telefone, p.nome, r.wamid, FECHO_DO_LOTE, null, 'luigi')
    }
    await concluir(p.id)
    return { enviadas, restantes: 0, concluido: true, motivo: desistir ? 'passou do tempo — fechou com o que tinha' : undefined }
  } catch (err) {
    await soltarAVez(pedidoId).catch(() => undefined)
    throw err
  }
}

async function concluir(pedidoId: string): Promise<void> {
  await supabaseAdmin.from('pedidos_assistente').update({ previas_lote_em: null, previas_lote_rodando_em: null }).eq('id', pedidoId)
}

/**
 * O que o turno não terminou — cron de 1 minuto (luigi-seguir). Poucos
 * pedidos por vez: cada imagem é uma chamada de IA de dezenas de segundos e a
 * função tem 60 s.
 */
export async function enviarPreviasPendentes(orcamentoMs = 45_000): Promise<{ pedidos: number; enviadas: number; concluidos: number }> {
  const inicio = Date.now()
  const saida = { pedidos: 0, enviadas: 0, concluidos: 0 }
  const { data } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id')
    .not('previas_lote_em', 'is', null)
    .order('previas_lote_em', { ascending: true })
    .limit(3)
  for (const p of (data ?? []) as Array<{ id: string }>) {
    const sobra = orcamentoMs - (Date.now() - inicio)
    if (sobra < 15_000) break
    saida.pedidos++
    try {
      const r = await rodarLotePrevias(p.id, sobra)
      saida.enviadas += r.enviadas
      if (r.concluido) saida.concluidos++
    } catch (err) {
      console.error('[previas-lote] cron falhou num pedido', { pedido: p.id, err })
    }
  }
  return saida
}
