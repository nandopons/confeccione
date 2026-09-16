// app/lib/horario-comercial.ts
// ============================================================================
// CONTA DE HORA COMERCIAL (09/09/2026)
//
// A oferta automática dá 3 horas pra confecção responder, e essas 3 horas são
// COMERCIAIS: uma oferta mandada às 18h não pode vencer às 21h, com a pessoa
// dormindo. Ela vence às 9h do dia seguinte — 1h de sobra hoje, 2h amanhã.
//
// A janela é 7h–19h no fuso de Recife. Fuso importa: o servidor roda em UTC, e
// "19h" lá é 16h aqui. Toda conta abaixo é feita nas horas de Recife e só no
// fim volta pra instante absoluto.
//
// Fim de semana conta como horário comercial de propósito. Confecção pequena
// trabalha sábado, e segurar um pedido parado até segunda por purismo de
// calendário custa mais do que a chance de incomodar alguém num sábado à tarde.
// ============================================================================

// O fuso e a leitura de partes vêm de `horario.ts`, que é o único lugar do
// repo que responde "que horas são" no fuso do negócio. Este arquivo já tinha
// a sua própria cópia de `emRecife`; duas cópias é como o scheduler acabou
// contando em São Paulo enquanto o fechador contava em Recife.
import { partesEmRecife as emRecife } from './horario'

export const HORA_ABRE = 7
export const HORA_FECHA = 19

/**
 * Deslocamento de Recife em relação ao UTC, em minutos, naquele instante.
 * Recife não tem horário de verão hoje, mas derivar do dado é mais seguro do
 * que fixar -180 e descobrir o contrário num feriado de calendário.
 */
function offsetMin(d: Date): number {
  const r = emRecife(d)
  const comoUtc = Date.UTC(r.ano, r.mes - 1, r.dia, r.hora, r.minuto)
  // Zera segundos dos dois lados pra diferença ser só de fuso.
  const base = Math.floor(d.getTime() / 60000) * 60000
  return Math.round((comoUtc - base) / 60000)
}

/** Instante absoluto a partir de uma data/hora local de Recife. */
function deRecife(ano: number, mes: number, dia: number, hora: number, minuto: number, ref: Date): Date {
  const chute = new Date(Date.UTC(ano, mes - 1, dia, hora, minuto))
  return new Date(chute.getTime() - offsetMin(ref) * 60000)
}

/** Está dentro da janela de envio agora? */
export function dentroDoHorarioComercial(d: Date = new Date()): boolean {
  const { hora } = emRecife(d)
  return hora >= HORA_ABRE && hora < HORA_FECHA
}

/**
 * `horas` horas comerciais depois de `inicio`.
 *
 * Se `inicio` cai fora da janela, a contagem começa na próxima abertura — quem
 * recebe às 22h tem as 3 horas inteiras a partir das 7h, não um resto.
 */
export function somarHorasComerciais(horas: number, inicio: Date = new Date()): Date {
  let restanteMin = Math.round(horas * 60)
  let cursor = new Date(inicio)

  // No máximo 30 saltos de dia: trava contra laço infinito se alguém configurar
  // HORA_ABRE >= HORA_FECHA por engano.
  for (let i = 0; i < 30 && restanteMin > 0; i++) {
    const { ano, mes, dia, hora, minuto } = emRecife(cursor)

    if (hora < HORA_ABRE) {
      cursor = deRecife(ano, mes, dia, HORA_ABRE, 0, cursor)
      continue
    }
    if (hora >= HORA_FECHA) {
      // Amanhã, 7h. Somar 1 dia em UTC e reposicionar resolve virada de mês.
      const amanha = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)
      const a = emRecife(amanha)
      cursor = deRecife(a.ano, a.mes, a.dia, HORA_ABRE, 0, amanha)
      continue
    }

    const minutosAteFechar = (HORA_FECHA - hora) * 60 - minuto
    if (restanteMin <= minutosAteFechar) {
      return new Date(cursor.getTime() + restanteMin * 60000)
    }
    restanteMin -= minutosAteFechar
    cursor = new Date(cursor.getTime() + minutosAteFechar * 60000)
  }

  return cursor
}

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
