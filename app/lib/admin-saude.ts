// app/lib/admin-saude.ts
// ============================================================================
// Funções puras pro semáforo de saúde do dashboard /admin.
//
// SEM I/O — nada de Supabase, nada de Date.now() interno. Tudo recebe dados
// via parâmetro. Razões:
//   1. Testável em isolamento (sem mock de banco/tempo)
//   2. Determinístico — mesmo input = mesmo output
//   3. Estável entre render server e client (Next 16 Server Components)
//      pra evitar hidratação inconsistente
//
// O caller (app/admin/(painel)/page.tsx) coleta as métricas via queries
// e invoca essas funções com os números prontos + agoraMs injetado.
// ============================================================================

export type SemaforoStatus = 'verde' | 'amarelo' | 'vermelho'

export type SemaforoMetricas = {
  /** Minutos desde a última execução de detectar-gaps. null se cron_execucoes
   *  estiver vazia (nunca executou). Vermelho automático nesse caso. */
  minutosDesdeUltimoCron: number | null

  /** Quantos órfãos foram registrados na última hora (pedidos_orfaos.criado_em). */
  orfaosNovosNestaHora: number

  /** Ofertas com status='enviada' e enviada_em < agora - 24h. */
  ofertasEnviadasMais24h: number

  /** Ofertas com status='enviada' e enviada_em < agora - 48h. */
  ofertasEnviadasMais48h: number

  /** Pedidos sem oferta nenhuma há mais de 8h (aguardando captação manual,
   *  já fora da janela de retomar via buscar_apos). */
  pedidosSemOfertaMais8h: number
}

/** Calcula status do semáforo a partir das métricas.
 *  Mostra o PIOR estado: qualquer condição de 🔴 → 🔴; senão qualquer 🟡 → 🟡;
 *  senão 🟢. Regras combinadas na mini-sprint admin-overview. */
export function calcularStatusSemaforo(m: SemaforoMetricas): SemaforoStatus {
  // 🔴 — sistema travado ou nunca executou
  if (m.minutosDesdeUltimoCron === null || m.minutosDesdeUltimoCron > 180) {
    return 'vermelho'
  }
  if (m.pedidosSemOfertaMais8h >= 3) return 'vermelho'
  if (m.ofertasEnviadasMais48h >= 5) return 'vermelho'

  // 🟡 — atenção
  if (m.minutosDesdeUltimoCron > 90) return 'amarelo'
  if (m.orfaosNovosNestaHora >= 1) return 'amarelo'
  if (m.ofertasEnviadasMais24h >= 1) return 'amarelo'

  return 'verde'
}

/** Formata duração relativa: "há 5 min", "há 2h", "há 3 dias", "agora".
 *  agoraMs injetado (sem Date.now() interno) pra determinismo. */
export function formatarDuracaoRelativa(
  msTimestamp: number,
  agoraMs: number
): string {
  const diffMs = Math.max(0, agoraMs - msTimestamp)
  const minutos = Math.floor(diffMs / 60_000)

  if (minutos < 1) return 'agora'
  if (minutos < 60) return `há ${minutos} min`

  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `há ${horas}h`

  const dias = Math.floor(horas / 24)
  return `há ${dias} ${dias === 1 ? 'dia' : 'dias'}`
}

/** Formata duração em horas pra string legível: "<1h", "5h", "8d 4h".
 *  Sem Date.now() interno — recebe horas já calculadas pelo caller.
 *  Casos:
 *    horas < 1       → '< 1h'
 *    horas < 24      → 'Xh' (truncado)
 *    horas % 24 == 0 → 'Nd'
 *    else            → 'Nd Hh'
 *
 *  Usado em tabelas admin pra coluna "Idade" (pedido, oferta, etc). */
export function formatarIdadeHoras(horas: number): string {
  if (horas < 1) return '< 1h'
  if (horas < 24) return `${Math.floor(horas)}h`
  const dias = Math.floor(horas / 24)
  const restoHoras = Math.floor(horas % 24)
  return restoHoras > 0 ? `${dias}d ${restoHoras}h` : `${dias}d`
}

/** Frase complementar abaixo do título do semáforo.
 *  ultimaExecucaoMs nullable: null = cron_execucoes vazia. */
export function mensagemSemaforo(
  status: SemaforoStatus,
  m: SemaforoMetricas,
  agoraMs: number,
  ultimaExecucaoMs: number | null
): string {
  // Caso edge: cron nunca executou
  if (m.minutosDesdeUltimoCron === null || ultimaExecucaoMs === null) {
    return 'Última detecção: nunca · Cron pode estar parado. Aguarde a próxima hora cheia ou rode o cron manualmente.'
  }

  const relativo = formatarDuracaoRelativa(ultimaExecucaoMs, agoraMs)
  const partes: string[] = [`Última detecção ${relativo}`]

  partes.push(
    m.orfaosNovosNestaHora === 0
      ? '0 órfãos novos nesta hora'
      : `${m.orfaosNovosNestaHora} ${m.orfaosNovosNestaHora === 1 ? 'órfão novo' : 'órfãos novos'} nesta hora`
  )

  // Avisos contextuais — só aparecem se houver problema relevante
  if (m.ofertasEnviadasMais48h >= 5) {
    partes.push(
      `⚠️ ${m.ofertasEnviadasMais48h} ofertas enviadas há mais de 48h`
    )
  } else if (m.ofertasEnviadasMais24h >= 1) {
    partes.push(
      `${m.ofertasEnviadasMais24h} ${m.ofertasEnviadasMais24h === 1 ? 'oferta enviada' : 'ofertas enviadas'} há mais de 24h`
    )
  }

  if (m.pedidosSemOfertaMais8h >= 3) {
    partes.push(
      `⚠️ ${m.pedidosSemOfertaMais8h} pedidos sem oferta há mais de 8h`
    )
  }

  return partes.join(' · ')
}
