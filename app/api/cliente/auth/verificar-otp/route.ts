// app/api/cliente/auth/verificar-otp/route.ts
// ============================================================================
// POST /api/cliente/auth/verificar-otp
// Body: { email: string, codigo: string }
//
// Fluxo:
//   1. Busca conta por email → 400 se não existir (não criar aqui)
//   2. Verifica bloqueio → 429
//   3. Valida OTP → 400 com motivo
//   4. Backfill lazy: vincula pedidos com mesmo email à conta
//   5. Cria sessão (hash-only no banco)
//   6. Atualiza ultimo_login_em
//   7. Seta cookie HttpOnly + Secure(prod) + SameSite=Lax + 30d
//   8. Retorna { ok: true }
// ============================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import {
  COOKIE_CLIENTE,
  SESSAO_DURACAO_DIAS,
  criarSessao,
  estaBloqueado,
  tempoBloqueioRestante,
  validarOtp,
} from '@/app/lib/cliente-auth'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: Request) {
  let body: { email?: string; codigo?: string; client?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ erro: 'payload inválido' }, { status: 400 })
  }

  const email = (body.email ?? '').trim().toLowerCase()
  const codigo = (body.codigo ?? '').trim()

  if (!EMAIL_REGEX.test(email)) {
    return NextResponse.json({ erro: 'email inválido' }, { status: 400 })
  }
  if (!/^\d{6}$/.test(codigo)) {
    return NextResponse.json({ erro: 'código inválido' }, { status: 400 })
  }

  // 1. Busca conta
  const { data: conta } = await supabaseAdmin
    .from('contas_clientes')
    .select('id, email, whatsapp, nome')
    .eq('email', email)
    .maybeSingle()

  if (!conta) {
    return NextResponse.json(
      { erro: 'código inválido ou expirado' },
      { status: 400 },
    )
  }

  // 2. Bloqueio
  if (await estaBloqueado(conta.id)) {
    const ate = await tempoBloqueioRestante(conta.id)
    return NextResponse.json(
      { erro: 'conta bloqueada por tentativas excedidas', bloqueado_ate: ate },
      { status: 429 },
    )
  }

  // 3. Valida OTP
  const resultado = await validarOtp({ contaId: conta.id, codigo })
  if (!resultado.valido) {
    const status = resultado.motivo === 'tentativas_excedidas' ? 429 : 400
    const mensagens: Record<string, string> = {
      codigo_incorreto: 'código incorreto',
      codigo_nao_encontrado: 'código inválido ou expirado',
      bloqueado: 'conta bloqueada',
      tentativas_excedidas: 'tentativas excedidas — conta bloqueada por 30min',
    }
    return NextResponse.json(
      {
        erro: mensagens[resultado.motivo ?? 'codigo_incorreto'] ?? 'erro',
        motivo: resultado.motivo,
      },
      { status },
    )
  }

  // 4. Backfill lazy: vincula pedidos com mesmo email à conta
  // best-effort, não bloqueia login se falhar
  try {
    await supabaseAdmin
      .from('pedidos')
      .update({ conta_id: conta.id })
      .ilike('email', email)
      .is('conta_id', null)
  } catch (err) {
    console.error('[cliente/verificar-otp] backfill falhou:', err)
  }

  // 5. Cria sessão
  const userAgent = req.headers.get('user-agent') ?? null
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    null

  let token: string
  try {
    const sessao = await criarSessao({
      contaId: conta.id,
      userAgent,
      ip,
    })
    token = sessao.token
  } catch (err) {
    console.error('[cliente/verificar-otp] criarSessao falhou:', err)
    return NextResponse.json({ erro: 'erro ao processar' }, { status: 500 })
  }

  // 6. Atualiza ultimo_login_em (best-effort)
  supabaseAdmin
    .from('contas_clientes')
    .update({
      ultimo_login_em: new Date().toISOString(),
      atualizado_em: new Date().toISOString(),
    })
    .eq('id', conta.id)
    .then(
      () => undefined,
      (err) =>
        console.error('[cliente/verificar-otp] ultimo_login_em falhou:', err),
    )

  // 7. Seta cookie
  const c = await cookies()
  c.set({
    name: COOKIE_CLIENTE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSAO_DURACAO_DIAS * 24 * 60 * 60,
  })

  // 8. App mobile não usa cookie: quando sinalizado (header X-Client: mobile OU
  //    body { client: 'mobile' }), devolve TAMBÉM o token cru. Mesmo token já
  //    setado no cookie — sem nova sessão. Sem o sinal, resposta idêntica à web.
  const ehMobile =
    req.headers.get('x-client')?.toLowerCase() === 'mobile' ||
    (body.client ?? '').toLowerCase() === 'mobile'

  return NextResponse.json(ehMobile ? { ok: true, token } : { ok: true })
}
