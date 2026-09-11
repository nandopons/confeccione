// app/lib/admin-saude.ts
// ============================================================================
// Formatadores de duração do painel /admin.
//
// O SEMÁFORO SAIU DAQUI — 11/09/2026. `calcularStatusSemaforo`,
// `mensagemSemaforo` e seus tipos mediam `pedidos_orfaos`, `ofertas` e
// `pedidos` — a era morta desde junho. Quatro das cinco métricas não existem
// na era viva, e a principal (oferta vencida sem resposta) não tem como ser
// medida: `expira_em` é NULL em 100% de `ofertas_pedido_assistente`. Ficaria
// verde medindo um sistema parado, e verde falso manda não olhar.
//
// O que sobrou aqui são os formatadores, usados por /admin/pedidos e pelo
// modal de órfãos. O topo do painel virou app/lib/admin-topo.ts.
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

/** Formata duração no FUTURO: "em 14h", "em 2 dias", "agora".
 *  Espelha formatarDuracaoRelativa mas mostra o sentido oposto (esperado).
 *  agoraMs injetado pra determinismo. */
export function formatarDuracaoFutura(
  msTimestamp: number,
  agoraMs: number
): string {
  const diffMs = Math.max(0, msTimestamp - agoraMs)
  const minutos = Math.floor(diffMs / 60_000)

  if (minutos < 1) return 'agora'
  if (minutos < 60) return `em ${minutos} min`

  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `em ${horas}h`

  const dias = Math.floor(horas / 24)
  return `em ${dias} ${dias === 1 ? 'dia' : 'dias'}`
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
