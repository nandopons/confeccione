// app/lib/rastreio.ts
// ============================================================================
// Tracker 1st-party do site público — alimenta o painel /admin/funil.
//
// Anônimo e leve: sessão = uuid em localStorage; origem = utm_* da URL (last
// non-direct touch) ou referrer externo da primeira visita. Envio via
// sendBeacon (não bloqueia navegação) com fallback fetch keepalive.
//
// USO EXCLUSIVAMENTE CLIENT-SIDE (referencia window/localStorage). Todas as
// funções são failure-soft: analytics nunca pode quebrar o site.
// ============================================================================

const K_SESSAO = 'cf_sessao_id'
const K_ORIGEM = 'cf_origem'

export type Origem = {
  source: string | null
  medium: string | null
  campaign: string | null
  /**
   * Identificador do clique do Google Ads (26/08/2026).
   *
   * O Ads usa MARCAÇÃO AUTOMÁTICA: o clique chega com `?gclid=...` e nenhum
   * `utm_*`. Guardar só UTM era guardar nada — 346 pageviews desde que a
   * campanha subiu, zero rastreáveis até o anúncio.
   *
   * `gbraid`/`wbraid` (o par que o iOS manda quando não há gclid) entram
   * nesta MESMA chave, com prefixo `gbraid:` / `wbraid:`, pra não multiplicar
   * coluna por variante do Google.
   */
  gclid: string | null
  referrer: string | null
}

/** O que vai no corpo do POST — nomes já no formato das colunas do banco. */
export type Atribuicao = {
  gclid: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  referrer: string | null
}

const MAX_GCLID = 120 // o gclid real tem ~90

function seguro<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

/** Id anônimo estável do navegador (não identifica a pessoa). */
export function sessaoId(): string {
  return seguro(() => {
    let id = localStorage.getItem(K_SESSAO)
    if (!id) {
      id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2) + Date.now().toString(36)
      localStorage.setItem(K_SESSAO, id)
    }
    return id
  }, 'anon')
}

/** gclid / gbraid / wbraid da URL, já cortado e com prefixo quando é variante. */
function cliquePago(p: URLSearchParams): string | null {
  const gclid = p.get('gclid')
  if (gclid) return gclid.slice(0, MAX_GCLID)
  const gbraid = p.get('gbraid')
  if (gbraid) return `gbraid:${gbraid}`.slice(0, MAX_GCLID)
  const wbraid = p.get('wbraid')
  if (wbraid) return `wbraid:${wbraid}`.slice(0, MAX_GCLID)
  return null
}

/**
 * Captura a origem do tráfego. Regras:
 * - URL com utm_* OU com gclid/gbraid/wbraid → sobrescreve (last non-direct
 *   touch: o anúncio mais recente leva o crédito). Um UTM novo de outra
 *   campanha zera o gclid antigo junto — senão o crédito ficaria dividido
 *   entre dois anúncios.
 * - Clique pago SEM utm (o caso normal do Google Ads, que usa marcação
 *   automática) vira origem `google` / `cpc`.
 * - Sem nada disso e nada gravado → guarda o referrer externo (ou vazio =
 *   direto). Navegação interna e visita direta POSTERIOR não apagam o clique
 *   já gravado.
 */
export function capturarOrigem(): void {
  seguro(() => {
    const p = new URLSearchParams(location.search)
    const gclid = cliquePago(p)
    const source = p.get('utm_source')
    const medium = p.get('utm_medium')
    const campaign = p.get('utm_campaign')
    const temUtm = Boolean(source || medium || campaign)

    if (temUtm || gclid) {
      const nova: Origem = {
        source: source ?? (gclid ? 'google' : null),
        medium: medium ?? (gclid ? 'cpc' : null),
        campaign,
        gclid,
        referrer: null,
      }
      localStorage.setItem(K_ORIGEM, JSON.stringify(nova))
      return
    }
    if (localStorage.getItem(K_ORIGEM)) return
    const refExterno =
      document.referrer && !document.referrer.includes(location.hostname)
        ? document.referrer.slice(0, 300)
        : null
    localStorage.setItem(
      K_ORIGEM,
      JSON.stringify({
        source: null,
        medium: null,
        campaign: null,
        gclid: null,
        referrer: refExterno,
      }),
    )
  }, undefined)
}

export function origem(): Origem {
  const vazio: Origem = {
    source: null,
    medium: null,
    campaign: null,
    gclid: null,
    referrer: null,
  }
  const lido = seguro<Partial<Origem> | null>(() => {
    const raw = localStorage.getItem(K_ORIGEM)
    return raw ? (JSON.parse(raw) as Partial<Origem>) : null
  }, null)
  if (!lido) return vazio
  // Origem gravada ANTES de 26/08 não tem `gclid` — sem o ?? null ela voltaria
  // undefined e entraria no JSON do POST como campo ausente.
  return {
    source: lido.source ?? null,
    medium: lido.medium ?? null,
    campaign: lido.campaign ?? null,
    gclid: lido.gclid ?? null,
    referrer: lido.referrer ?? null,
  }
}

/** Origem no formato do corpo do POST (criar pedido). Nunca lança. */
export function atribuicao(): Atribuicao {
  const o = origem()
  return {
    gclid: o.gclid,
    utm_source: o.source,
    utm_medium: o.medium,
    utm_campaign: o.campaign,
    referrer: o.referrer,
  }
}

export type TipoEvento = 'pageview' | 'assistente_iniciado' | 'pedido_enviado' | 'whatsapp_click'

/** Registra um evento no funil. Nunca lança; nunca bloqueia a UI. */
export function track(tipo: TipoEvento, extra?: { pagina?: string; referenciaId?: string }): void {
  seguro(() => {
    const o = origem()
    const corpo = JSON.stringify({
      sessao_id: sessaoId(),
      tipo,
      pagina: (extra?.pagina ?? location.pathname).slice(0, 300),
      utm_source: o.source,
      utm_medium: o.medium,
      utm_campaign: o.campaign,
      gclid: o.gclid,
      referrer: o.referrer,
      referencia_id: extra?.referenciaId ?? null,
    })
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon('/api/eventos', new Blob([corpo], { type: 'application/json' }))
    } else {
      void fetch('/api/eventos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: corpo,
        keepalive: true,
      }).catch(() => undefined)
    }
  }, undefined)
}
