// app/lib/wa-saude.ts
// ============================================================================
// Saúde do WhatsApp: como o painel sabe que os recibos da Meta pararam.
//
// O CONTEXTO (26/08/2026):
//
// Toda mensagem que sai nasce com status 'enviando'. Quem promove pra
// 'enviado' → 'entregue' → 'lido' (ou 'falhou') é o webhook da Meta, em
// app/api/whatsapp/webhook/route.ts. Se o webhook para de chegar, o banco
// congela em 'enviando' e a UI mostra o relógio pra sempre — sem que ninguém
// perceba que a causa é externa.
//
// Foi exatamente o que aconteceu: **nenhum recibo desde 11/08 e nenhuma
// mensagem recebida desde 10/08**, com 57 mensagens presas em 'enviando'.
// Dezesseis dias em que quem respondeu no WhatsApp ficou invisível e o painel
// não deu um pio.
//
// Este módulo não conserta o webhook — isso é configuração no app da Meta.
// Ele faz o painel PARAR DE FINGIR que está tudo bem: mede o sintoma que só
// existe quando os recibos sumiram (mensagem antiga ainda em 'enviando') e
// devolve um veredito que a interface mostra.
//
// Sem banco e sem rede aqui de propósito — dá pra testar com números na mão.
// ============================================================================

/** Abaixo disso, relógio é normal: o recibo da Meta leva alguns segundos. */
export const SEGUNDOS_ENVIO_NORMAL = 90

/** Acima disso, um 'enviando' não é lentidão — é recibo que não voltou. */
export const MINUTOS_SEM_CONFIRMACAO = 10

/**
 * Quantas mensagens velhas presas em 'enviando' bastam pra acusar o webhook.
 * Uma pode ser azar (número inválido, corrida de rede). Três seguidas, não.
 */
export const PRESAS_PARA_ACUSAR = 3

export type EstadoEnvio =
  /** saiu agora, relógio é esperado */
  | 'normal'
  /** passou do normal mas ainda pode chegar */
  | 'demorando'
  /** velha demais: o recibo não vem mais */
  | 'sem_confirmacao'

/**
 * Em que pé está uma mensagem de saída parada em 'enviando'.
 * Só faz sentido pra status 'enviando' — os outros já têm resposta da Meta.
 */
export function estadoDoEnvio(criadoEm: string, agora: number): EstadoEnvio {
  const t = Date.parse(criadoEm)
  if (!Number.isFinite(t)) return 'normal'
  const segundos = (agora - t) / 1000
  if (segundos < SEGUNDOS_ENVIO_NORMAL) return 'normal'
  if (segundos < MINUTOS_SEM_CONFIRMACAO * 60) return 'demorando'
  return 'sem_confirmacao'
}

export type Medida = {
  /** Mensagens de saída antigas ainda em 'enviando' (janela de 7 dias). */
  presas: number
  /** Última mensagem RECEBIDA de um contato, ISO. */
  ultimaEntrada: string | null
  /** Último recibo da Meta (saída que saiu de 'enviando'), ISO. */
  ultimoRecibo: string | null
}

export type Diagnostico = {
  /** false = os recibos da Meta não estão chegando. */
  recibosOk: boolean
  presas: number
  ultimaEntrada: string | null
  ultimoRecibo: string | null
  /** Desde quando está assim — o mais recente entre entrada e recibo. */
  mudoDesde: string | null
  /** Dias inteiros desde `mudoDesde`, pra frase da interface. */
  diasMudo: number | null
}

/**
 * O veredito. `recibosOk: false` significa: as mensagens até saem (a API
 * aceita e devolve wamid), mas o painel não tem como saber se chegaram — e,
 * pelo mesmo cano, nada que os contatos escreverem entra aqui.
 */
export function diagnosticar(m: Medida, agora: number): Diagnostico {
  const recibosOk = m.presas < PRESAS_PARA_ACUSAR

  const marcos = [m.ultimaEntrada, m.ultimoRecibo]
    .filter((s): s is string => Boolean(s))
    .map((s) => Date.parse(s))
    .filter((t) => Number.isFinite(t))

  const maisRecente = marcos.length > 0 ? Math.max(...marcos) : null
  const mudoDesde = maisRecente === null ? null : new Date(maisRecente).toISOString()
  const diasMudo = maisRecente === null ? null : Math.floor((agora - maisRecente) / 86_400_000)

  return { recibosOk, presas: m.presas, ultimaEntrada: m.ultimaEntrada, ultimoRecibo: m.ultimoRecibo, mudoDesde, diasMudo }
}

/** Data curta pt-BR (dd/mm) a partir de ISO — usada no aviso da interface. */
export function diaCurto(iso: string | null): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const d = new Date(t)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}
