// app/api/admin/cron-disparar/route.ts
// ============================================================================
// POST /api/admin/cron-disparar
//
// Proxy autenticado por cookie admin que dispara o cron detectar-gaps
// manualmente. Reusa a rota real do cron via fetch interno com Bearer
// CRON_SECRET pra que a execução manual também registre em cron_execucoes
// (e o semáforo do dashboard recalcule pro estado correto depois).
//
// NÃO chama detectarOrfaos() direto — manter a rota do cron como única
// fonte de execução evita drift de comportamento e de instrumentação.
//
// Status codes:
//   200  → cron rodou OK (passa response do cron adiante)
//   401  → cookie admin ausente ou inválido
//   500  → CRON_SECRET não configurado no env
//   502  → fetch interno falhou OU cron retornou non-2xx
//
// Limitação conhecida: em preview com Vercel Deployment Protection ativa,
// o fetch interno pode dar 401 pelo edge SSO antes do Bearer ser
// inspecionado. Em produção (sem SSO) funciona normal. Pra preview,
// usar o "Detectar agora" do /admin/orfaos como alternativa.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'

export async function POST(req: NextRequest) {
  // Defesa em profundidade — middleware já bloqueia /api/admin/* sem
  // cookie válido (length≥32); revalidamos cookie === ADMIN_SESSION_TOKEN.
  const cookieValue = req.cookies.get(COOKIE_ADMIN)?.value
  if (!ehTokenAdminValido(cookieValue)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[admin/cron-disparar] CRON_SECRET ausente no env')
    return NextResponse.json(
      { erro: 'Configuração inválida' },
      { status: 500 }
    )
  }

  // URL absoluta derivada do host atual (production, preview, dev) —
  // sem env extra. new URL(path, base) usa o base como origin.
  const cronUrl = new URL('/api/cron/detectar-gaps', req.url).toString()

  let cronRes: Response
  try {
    cronRes = await fetch(cronUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${cronSecret}` },
      cache: 'no-store',
    })
  } catch (err) {
    console.error('[admin/cron-disparar] fetch interno falhou:', err)
    return NextResponse.json(
      { erro: 'Falha ao contactar o cron' },
      { status: 502 }
    )
  }

  const body = await cronRes.json().catch(() => null)

  if (!cronRes.ok) {
    console.error(
      '[admin/cron-disparar] cron retornou non-2xx:',
      cronRes.status,
      body
    )
    return NextResponse.json(
      { erro: 'Cron retornou erro', status: cronRes.status, body },
      { status: 502 }
    )
  }

  return NextResponse.json(body)
}
