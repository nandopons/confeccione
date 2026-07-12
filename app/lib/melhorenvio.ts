// app/lib/melhorenvio.ts
// ============================================================================
// Integração Melhor Envio — OAuth por FORNECEDOR via aplicativo da Confeccione.
//
// Modelo: cada fornecedor conecta a própria conta ME (etiqueta e eventuais
// reajustes de volumetria correm na carteira DELE). A Confeccione fornece o
// aplicativo OAuth, a cotação integrada no orçamento e (fase 2) a compra de
// etiqueta pelo painel — o que mantém os webhooks no nosso app.
//
// Env (Vercel + .env.local):
//   MELHORENVIO_URL           → https://sandbox.melhorenvio.com.br (dev) ou
//                               https://melhorenvio.com.br (produção)
//   MELHORENVIO_CLIENT_ID     → id do aplicativo (Área Dev)
//   MELHORENVIO_CLIENT_SECRET → secret do aplicativo (também assina o state)
//
// Tokens: access 30d / refresh 45d. Renovação LAZY no uso (expirando em <7d)
// + cron diário renova os que expiram em <10d (mantém contas vivas).
// Regra serverless: sempre await antes de retornar.
// ============================================================================

import { createHmac, timingSafeEqual } from 'crypto'
import { supabaseAdmin } from './supabase-server'
import { SITE_URL } from './url'

export const ME_URL = process.env.MELHORENVIO_URL || 'https://sandbox.melhorenvio.com.br'
const CLIENT_ID = process.env.MELHORENVIO_CLIENT_ID
const CLIENT_SECRET = process.env.MELHORENVIO_CLIENT_SECRET

// Escopos das fases 1 e 2 (cotação + carrinho/checkout/etiqueta/rastreio) —
// pedir tudo já evita reautorização quando a fase 2 entrar.
const SCOPES =
  'shipping-calculate shipping-checkout shipping-companies shipping-generate shipping-preview shipping-print shipping-tracking cart-read cart-write orders-read users-read ecommerce-shipping'

const USER_AGENT = 'Confeccione (contato@confeccione.com.br)'

export function melhorEnvioConfigurado(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET)
}

export function callbackUrl(): string {
  return `${SITE_URL}/api/fornecedor/melhorenvio/callback`
}

// ─────────────────────────────────────────────────────────────
// State assinado (sem tabela extra): carrega fornecedor + volta + validade.
// A página de orçamento é acessada por UUID de oferta (sem sessão), então o
// vínculo do callback vem deste state — assinado com o client secret.
// ─────────────────────────────────────────────────────────────

type StatePayload = { f: string; voltar: string; exp: number }

function assinar(dados: string): string {
  return createHmac('sha256', CLIENT_SECRET ?? 'dev').update(dados).digest('base64url')
}

export function gerarState(fornecedorId: string, voltar: string): string {
  const payload: StatePayload = { f: fornecedorId, voltar, exp: Date.now() + 15 * 60 * 1000 }
  const corpo = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${corpo}.${assinar(corpo)}`
}

export function validarState(state: string): StatePayload | null {
  const [corpo, assinatura] = state.split('.')
  if (!corpo || !assinatura) return null
  const esperada = assinar(corpo)
  const a = Buffer.from(assinatura)
  const b = Buffer.from(esperada)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(corpo, 'base64url').toString()) as StatePayload
    if (!payload.f || payload.exp < Date.now()) return null
    // voltar só pode ser caminho interno (evita open redirect)
    if (!payload.voltar?.startsWith('/')) payload.voltar = '/fornecedor/painel/envio'
    return payload
  } catch {
    return null
  }
}

export function urlAutorizacao(state: string): string {
  const q = new URLSearchParams({
    client_id: CLIENT_ID ?? '',
    redirect_uri: callbackUrl(),
    response_type: 'code',
    state,
    scope: SCOPES,
  })
  return `${ME_URL}/oauth/authorize?${q.toString()}`
}

// ─────────────────────────────────────────────────────────────
// OAuth: troca de code e renovação
// ─────────────────────────────────────────────────────────────

type TokensME = { access_token: string; refresh_token: string; expires_in: number }

async function postOauthToken(body: Record<string, string>): Promise<TokensME | null> {
  try {
    const res = await fetch(`${ME_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': USER_AGENT },
      body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...body }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.access_token) {
      console.error('[melhorenvio] oauth/token falhou', { status: res.status, erro: data?.error ?? data?.message })
      return null
    }
    return data as TokensME
  } catch (err) {
    console.error('[melhorenvio] oauth/token exception', { err })
    return null
  }
}

export async function trocarCodePorTokens(code: string): Promise<TokensME | null> {
  return await postOauthToken({ grant_type: 'authorization_code', redirect_uri: callbackUrl(), code })
}

async function renovarTokens(refreshToken: string): Promise<TokensME | null> {
  return await postOauthToken({ grant_type: 'refresh_token', refresh_token: refreshToken })
}

export async function salvarTokens(fornecedorId: string, t: TokensME): Promise<boolean> {
  const agora = new Date()
  const { error } = await supabaseAdmin.from('melhorenvio_contas').upsert({
    fornecedor_id: fornecedorId,
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expira_em: new Date(agora.getTime() + t.expires_in * 1000).toISOString(),
    atualizado_em: agora.toISOString(),
  })
  if (error) console.error('[melhorenvio] salvarTokens falhou', { fornecedorId, error })
  return !error
}

/** true se o fornecedor tem conta ME conectada (token válido ou renovável). */
export async function fornecedorConectado(fornecedorId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('melhorenvio_contas')
    .select('fornecedor_id')
    .eq('fornecedor_id', fornecedorId)
    .maybeSingle()
  return Boolean(data)
}

/**
 * Access token do fornecedor com renovação lazy: expirando em <7 dias,
 * renova via refresh_token e persiste. Null = precisa (re)conectar.
 */
export async function tokenDoFornecedor(fornecedorId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('melhorenvio_contas')
    .select('access_token, refresh_token, expira_em')
    .eq('fornecedor_id', fornecedorId)
    .maybeSingle<{ access_token: string; refresh_token: string; expira_em: string }>()
  if (!data) return null

  const expiraMs = new Date(data.expira_em).getTime()
  const seteDiasMs = 7 * 24 * 60 * 60 * 1000
  if (expiraMs - Date.now() > seteDiasMs) return data.access_token

  const novos = await renovarTokens(data.refresh_token)
  if (!novos) {
    // refresh vencido/revogado → precisa reconectar; token atual pode ainda valer
    return expiraMs > Date.now() ? data.access_token : null
  }
  await salvarTokens(fornecedorId, novos)
  return novos.access_token
}

/** Renova contas expirando em <N dias (cron). Retorna contagens. */
export async function renovarContasExpirando(dias = 10): Promise<{ total: number; renovadas: number; falhas: number }> {
  const limite = new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString()
  const { data } = await supabaseAdmin
    .from('melhorenvio_contas')
    .select('fornecedor_id, refresh_token')
    .lt('expira_em', limite)
    .limit(100)
  const linhas = (data ?? []) as Array<{ fornecedor_id: string; refresh_token: string }>
  let renovadas = 0
  let falhas = 0
  for (const l of linhas) {
    const novos = await renovarTokens(l.refresh_token)
    if (novos && (await salvarTokens(l.fornecedor_id, novos))) renovadas++
    else falhas++
  }
  return { total: linhas.length, renovadas, falhas }
}

// ─────────────────────────────────────────────────────────────
// Cotação de frete
// ─────────────────────────────────────────────────────────────

export type VolumeFrete = { altura: number; largura: number; comprimento: number; peso: number }

export type ServicoCotado = {
  id: number
  nome: string
  transportadora: string
  logo: string | null
  precoCentavos: number
  prazoDias: number
  entregaEstimada: string | null
}

/**
 * Cota o frete na conta DO fornecedor (preço real da conta dele).
 * Dimensões em cm, peso em kg, seguro em centavos (convertido pra reais).
 */
export async function cotarFrete(params: {
  fornecedorId: string
  cepOrigem: string
  cepDestino: string
  volumes: VolumeFrete[]
  seguroCentavos: number
}): Promise<{ ok: true; servicos: ServicoCotado[] } | { ok: false; erro: string; reconectar?: boolean }> {
  const token = await tokenDoFornecedor(params.fornecedorId)
  if (!token) return { ok: false, erro: 'Conta Melhor Envio não conectada.', reconectar: true }

  const seguroPorVolume = Math.max(params.seguroCentavos / 100 / Math.max(params.volumes.length, 1), 0.5)
  const body = {
    from: { postal_code: params.cepOrigem.replace(/\D/g, '') },
    to: { postal_code: params.cepDestino.replace(/\D/g, '') },
    volumes: params.volumes.map((v) => ({
      height: v.altura,
      width: v.largura,
      length: v.comprimento,
      weight: v.peso,
      insurance_value: Number(seguroPorVolume.toFixed(2)),
    })),
    options: { receipt: false, own_hand: false },
  }

  try {
    const res = await fetch(`${ME_URL}/api/v2/me/shipment/calculate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => null)
    if (res.status === 401) return { ok: false, erro: 'Autorização expirada — reconecte sua conta.', reconectar: true }
    if (!res.ok || !Array.isArray(data)) {
      const msg = data?.message || (data?.errors ? JSON.stringify(data.errors) : `HTTP ${res.status}`)
      console.error('[melhorenvio] calculate falhou', { status: res.status, msg })
      return { ok: false, erro: `Não deu pra cotar agora: ${msg}` }
    }

    type ServicoRaw = {
      id: number
      name: string
      error?: string
      custom_price?: string
      price?: string
      custom_delivery_time?: number
      delivery_time?: number
      delivery_range?: { min?: number; max?: number }
      company?: { name?: string; picture?: string }
    }
    const servicos = (data as ServicoRaw[])
      .filter((s) => !s.error && (s.custom_price || s.price))
      .map((s) => ({
        id: s.id,
        nome: s.name,
        transportadora: s.company?.name ?? '',
        logo: s.company?.picture ?? null,
        precoCentavos: Math.round(parseFloat(s.custom_price ?? s.price ?? '0') * 100),
        prazoDias: s.custom_delivery_time ?? s.delivery_time ?? s.delivery_range?.max ?? 0,
        entregaEstimada: null,
      }))
      .filter((s) => s.precoCentavos > 0)
      .sort((a, b) => a.precoCentavos - b.precoCentavos)

    if (servicos.length === 0) return { ok: false, erro: 'Nenhuma transportadora atende esse trecho/volumetria.' }
    return { ok: true, servicos }
  } catch (err) {
    console.error('[melhorenvio] calculate exception', { err })
    return { ok: false, erro: 'Falha de rede ao consultar o Melhor Envio.' }
  }
}
