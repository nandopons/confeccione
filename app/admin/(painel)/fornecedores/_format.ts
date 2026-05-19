// app/admin/(painel)/fornecedores/_format.ts
// ============================================================================
// Helpers de formatação compartilhados entre FornecedoresTabela e
// FornecedorOverlay (Fase 3a + 3b).
// ============================================================================

/**
 * Formata duração em ms pra string compacta legível.
 *   null         → "—"
 *   < 60s        → "Xs"
 *   < 60min      → "Xmin"
 *   < 24h        → "Xh Ymin" ou "Xh" se Y=0
 *   < 7d         → "X dias"
 *   < 4 semanas  → "X semanas"
 *   >= 4 semanas → "X meses"
 */
export function formatarDuracao(ms: number | null): string {
  if (ms === null || ms === undefined) return '—'
  if (ms < 0) return '—'

  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`

  const min = Math.floor(s / 60)
  if (min < 60) return `${min}min`

  const h = Math.floor(min / 60)
  const minResto = min % 60
  if (h < 24) {
    return minResto === 0 ? `${h}h` : `${h}h ${minResto}min`
  }

  const d = Math.floor(h / 24)
  if (d < 7) return `${d} ${d === 1 ? 'dia' : 'dias'}`

  const semanas = Math.floor(d / 7)
  if (semanas < 4) return `${semanas} ${semanas === 1 ? 'semana' : 'semanas'}`

  const meses = Math.floor(d / 30)
  return `${meses} ${meses === 1 ? 'mês' : 'meses'}`
}

/**
 * Formata data ISO pra texto relativo legível.
 *   null   → "nunca"
 *   hoje   → "hoje"
 *   1d     → "ontem"
 *   < 30d  → "X dias atrás"
 *   < 365d → "X meses atrás"
 *   >= 365d → "X anos atrás"
 */
export function formatarDataRelativa(iso: string | null): string {
  if (!iso) return 'nunca'
  const dias = calcularDiasInatividade(iso)
  if (dias === null) return 'nunca'
  if (dias === 0) return 'hoje'
  if (dias === 1) return 'ontem'
  if (dias < 30) return `${dias} dias atrás`
  if (dias < 365) {
    const meses = Math.floor(dias / 30)
    return `${meses} ${meses === 1 ? 'mês' : 'meses'} atrás`
  }
  const anos = Math.floor(dias / 365)
  return `${anos} ${anos === 1 ? 'ano' : 'anos'} atrás`
}

/**
 * Versão compacta do formatarDataRelativa pra cabeçalhos de tabela
 * (espaço apertado): "hoje", "ontem", "5d atrás", "3m atrás", "2a atrás".
 */
export function formatarUltimaOferta(iso: string | null): string {
  if (!iso) return 'nunca'
  const dias = calcularDiasInatividade(iso)
  if (dias === null) return 'nunca'
  if (dias === 0) return 'hoje'
  if (dias === 1) return 'ontem'
  if (dias < 30) return `${dias}d atrás`
  if (dias < 365) return `${Math.floor(dias / 30)}m atrás`
  return `${Math.floor(dias / 365)}a atrás`
}

/**
 * Dias inteiros entre `ultimoLead` e agora. Null se input vazio.
 */
export function calcularDiasInatividade(
  ultimoLead: string | null,
): number | null {
  if (!ultimoLead) return null
  const ms = Date.now() - new Date(ultimoLead).getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}
