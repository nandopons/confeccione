// app/lib/asaas.ts
// ============================================================================
// Cliente HTTP base do Asaas. Wrapper de fetch com auth e tratamento de erros.
// Configuração via env vars: ASAAS_API_KEY e ASAAS_API_URL.
// ============================================================================

const API_URL = process.env.ASAAS_API_URL!
const API_KEY = process.env.ASAAS_API_KEY!

if (!API_URL || !API_KEY) {
  console.warn(
    '[asaas] ASAAS_API_URL ou ASAAS_API_KEY não configuradas. Asaas não funcionará.'
  )
}

export type AsaasError = {
  code: string
  description: string
}

export class AsaasApiError extends Error {
  status: number
  errors: AsaasError[]

  constructor(status: number, errors: AsaasError[]) {
    const msg = errors.map((e) => `${e.code}: ${e.description}`).join('; ')
    super(`Asaas API error (${status}): ${msg}`)
    this.name = 'AsaasApiError'
    this.status = status
    this.errors = errors
  }
}

/**
 * Mapeia método de pagamento "interno" (lowercase) → billingType do Asaas.
 * Reusado por asaas-payments e asaas-subscriptions.
 */
export const ASAAS_BILLING_TYPE = {
  pix: 'PIX',
  boleto: 'BOLETO',
  cartao: 'CREDIT_CARD',
} as const

export type MetodoPagamento = keyof typeof ASAAS_BILLING_TYPE

/**
 * Fetch tipado contra a API do Asaas.
 * Lança AsaasApiError em caso de erro 4xx/5xx.
 *
 * Retry: 1 retry com backoff 1s em 503/504 ou erro de rede (timeout/socket).
 * NÃO retry em 4xx — esses são erros do caller (CPF inválido, etc) e tentar
 * de novo não muda o resultado. Beneficia todas as funções que usam asaasFetch.
 */
export async function asaasFetch<T = unknown>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
    body?: unknown
    query?: Record<string, string | number | undefined>
  } = {}
): Promise<T> {
  const { method = 'GET', body, query } = options

  let url = `${API_URL}${path}`

  if (query) {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) {
        params.append(k, String(v))
      }
    }
    const qs = params.toString()
    if (qs) url += `?${qs}`
  }

  const requestInit: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      access_token: API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  }

  // Tentativa 1; se falhar com 503/504/network error, retry 1× após 1s.
  let res: Response
  try {
    res = await fetch(url, requestInit)
    if (res.status === 503 || res.status === 504) {
      console.warn(`[asaas] ${res.status} em ${method} ${path}, retry em 1s`)
      await new Promise((r) => setTimeout(r, 1000))
      res = await fetch(url, requestInit)
    }
  } catch (err) {
    console.warn(`[asaas] erro de rede em ${method} ${path}, retry em 1s:`, err)
    await new Promise((r) => setTimeout(r, 1000))
    res = await fetch(url, requestInit)
  }

  // Asaas retorna JSON tanto em sucesso quanto em erro
  let data: unknown = null
  const text = await res.text()
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      // não-JSON: deixa data como null e usa text na mensagem de erro
    }
  }

  if (!res.ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errors = (data as any)?.errors as AsaasError[] | undefined
    if (errors && Array.isArray(errors) && errors.length > 0) {
      throw new AsaasApiError(res.status, errors)
    }
    throw new AsaasApiError(res.status, [
      { code: 'unknown', description: text || res.statusText || 'erro desconhecido' },
    ])
  }

  return data as T
}

/**
 * Helper pra converter centavos pra reais (Asaas espera reais com decimais).
 * Ex: 7900 → 79.00
 */
export function centavosParaReais(centavos: number): number {
  return Math.round(centavos) / 100
}

/**
 * Helper pra converter reais pra centavos (Asaas devolve reais).
 * Ex: 79.00 → 7900
 */
export function reaisParaCentavos(reais: number): number {
  return Math.round(reais * 100)
}
