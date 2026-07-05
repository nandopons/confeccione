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
  referrer: string | null
}

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

/**
 * Captura a origem do tráfego. Regras:
 * - URL com utm_* → sobrescreve (last non-direct touch: o anúncio mais
 *   recente leva o crédito).
 * - Sem utm e nada gravado → guarda o referrer externo (ou vazio = direto).
 */
export function capturarOrigem(): void {
  seguro(() => {
    const p = new URLSearchParams(location.search)
    const utm: Origem = {
      source: p.get('utm_source'),
      medium: p.get('utm_medium'),
      campaign: p.get('utm_campaign'),
      referrer: null,
    }
    if (utm.source || utm.medium || utm.campaign) {
      localStorage.setItem(K_ORIGEM, JSON.stringify(utm))
      return
    }
    if (localStorage.getItem(K_ORIGEM)) return
    const refExterno =
      document.referrer && !document.referrer.includes(location.hostname)
        ? document.referrer.slice(0, 300)
        : null
    localStorage.setItem(
      K_ORIGEM,
      JSON.stringify({ source: null, medium: null, campaign: null, referrer: refExterno }),
    )
  }, undefined)
}

export function origem(): Origem {
  const vazio: Origem = { source: null, medium: null, campaign: null, referrer: null }
  return (
    seguro<Origem | null>(() => {
      const raw = localStorage.getItem(K_ORIGEM)
      return raw ? (JSON.parse(raw) as Origem) : null
    }, null) ?? vazio
  )
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
