// app/lib/horario.ts
// ============================================================================
// O FUSO MORA AQUI — 11/09/2026.
//
// Este arquivo dizia America/Sao_Paulo enquanto o resto do sistema dizia
// America/Recife. Hoje os dois têm o mesmo offset, então nada quebrou e nada
// vai quebrar amanhã — o problema é outro: duas respostas para "que horas são"
// no mesmo cron. O `podeFecharAgora` do fechador contava em Recife, a porteira
// do scheduler contava em São Paulo, e ler o código exigia checar qual era qual
// a cada vez.
//
// Se o horário de verão voltar em um dos dois estados, a divergência deixa de
// ser cosmética e vira pedido fechado na hora errada. Um helper só, um fuso só.
// Quem precisa de hora local do negócio importa daqui.
// ============================================================================

export const FUSO = 'America/Recife'

export type PartesLocais = {
  ano: number
  /** 1–12, como no calendário — NÃO é o mês 0-based do `Date`. */
  mes: number
  dia: number
  hora: number
  minuto: number
  /** 0 = domingo … 6 = sábado. */
  diaSemana: number
}

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/**
 * Partes da data no fuso do negócio, sem depender do fuso do servidor (que na
 * Vercel é UTC).
 *
 * `hourCycle: 'h23'` em vez de `hour12: false` é de propósito: com hour12 alguns
 * locales/ICU devolvem "24" para a meia-noite, e "24 < 8" é falso — a trava de
 * madrugada abriria justamente às 00h. Hoje o Node daqui devolve "00" nos dois
 * jeitos; h23 garante isso por contrato em vez de por sorte.
 */
export function partesEmRecife(d: Date = new Date()): PartesLocais {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: FUSO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  const g = (t: string) => partes.find((p) => p.type === t)?.value ?? '0'
  return {
    ano: Number(g('year')),
    mes: Number(g('month')),
    dia: Number(g('day')),
    hora: Number(g('hour')),
    minuto: Number(g('minute')),
    diaSemana: WD[g('weekday')] ?? 0,
  }
}

/** Atalho para quem só quer a hora do negócio. */
export function horaEmRecife(d: Date = new Date()): number {
  return partesEmRecife(d).hora
}

export function estaEmHorarioComercial(): boolean {
  const { diaSemana, hora } = partesEmRecife()
  return diaSemana >= 1 && diaSemana <= 5 && hora >= 8 && hora < 20
}

/**
 * Retorna true se a hora atual está dentro de uma das janelas de retry
 * passivo: 08:00-08:14 ou 15:00-15:14, em dia útil.
 *
 * Usado pela TAREFA 6 do scheduler pra reativar pedidos em buscando_fornecedor
 * que estão parados. Como o cron principal roda a cada 15 minutos, exatamente
 * uma execução por dia cai dentro de cada janela.
 */
export function estaEmJanelaRetryPassivo(): boolean {
  const { diaSemana, hora, minuto } = partesEmRecife()
  if (diaSemana < 1 || diaSemana > 5) return false
  if (minuto >= 15) return false
  return hora === 8 || hora === 15
}

export function proximoHorarioValido(): Date {
  const { diaSemana, hora, dia, mes, ano } = partesEmRecife()

  let add: number
  if (diaSemana === 0) {
    add = 1 // domingo -> segunda
  } else if (diaSemana === 6) {
    add = 2 // sábado -> segunda
  } else if (hora >= 20) {
    add = diaSemana === 5 ? 3 : 1 // sexta pós-20h -> segunda; outros -> dia seguinte
  } else {
    add = 0 // dia útil antes das 8h -> mesmo dia
  }

  // `mes` aqui é 1-based; o Date.UTC espera 0-based, daí o -1.
  const next = new Date(Date.UTC(ano, mes - 1, dia + add))
  const y = next.getUTCFullYear()
  const m = String(next.getUTCMonth() + 1).padStart(2, '0')
  const d = String(next.getUTCDate()).padStart(2, '0')
  return new Date(`${y}-${m}-${d}T08:00:00-03:00`)
}
