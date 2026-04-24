function brasilParts() {
  const agora = new Date()
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(agora)
  const g = (t: string) => parts.find(p => p.type === t)?.value ?? '0'
  const wdMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  }
  return {
    ano: parseInt(g('year')),
    mes: parseInt(g('month')) - 1,
    dia: parseInt(g('day')),
    hora: parseInt(g('hour')),
    diaSemana: wdMap[g('weekday')] ?? 0,
  }
}

export function estaEmHorarioComercial(): boolean {
  const { diaSemana, hora } = brasilParts()
  return diaSemana >= 1 && diaSemana <= 5 && hora >= 8 && hora < 22
}

export function proximoHorarioValido(): Date {
  const { diaSemana, hora, dia, mes, ano } = brasilParts()

  let add: number
  if (diaSemana === 0) {
    add = 1 // domingo -> segunda
  } else if (diaSemana === 6) {
    add = 2 // sábado -> segunda
  } else if (hora >= 22) {
    add = diaSemana === 5 ? 3 : 1 // sexta pós-22h -> segunda; outros -> dia seguinte
  } else {
    add = 0 // dia útil antes das 8h -> mesmo dia
  }

  const next = new Date(Date.UTC(ano, mes, dia + add))
  const y = next.getUTCFullYear()
  const m = String(next.getUTCMonth() + 1).padStart(2, '0')
  const d = String(next.getUTCDate()).padStart(2, '0')
  return new Date(`${y}-${m}-${d}T08:00:00-03:00`)
}
