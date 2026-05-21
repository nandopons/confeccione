// app/api/admin/captacao/route.ts
//
// POST -> insere contato(s) e dispara o CONVITE (etapa 0) na hora.
// GET  -> lista os contatos de captação (pro painel).
//
// Protegida pelo MESMO padrão das outras rotas admin:
//   req.cookies.get(COOKIE_ADMIN)?.value + ehTokenAdminValido.

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { getSegmento } from '@/app/lib/captacao-templates'
import { dispararToqueCaptacao, proximoAgendamento } from '@/app/lib/captacao'

type Entrada = {
  nome?: string
  email?: string
  whatsapp?: string
}

type ResultadoContato = {
  contato: Entrada
  ok: boolean
  motivo?: string
  email?: boolean | null
  whatsapp?: boolean | null
}

export async function POST(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'nao autorizado' }, { status: 401 })
  }

  const body = await req.json()
  const segmento: string = body.segmento
  const canalEmail: boolean = body.canal_email ?? true
  const canalWhatsapp: boolean = body.canal_whatsapp ?? false // default off (risco Z-API)
  const contatos: Entrada[] = Array.isArray(body.contatos) ? body.contatos : [body]

  if (!getSegmento(segmento)) {
    return NextResponse.json({ erro: 'segmento invalido' }, { status: 400 })
  }

  const resultados: ResultadoContato[] = []

  for (const c of contatos) {
    const email = c.email?.trim() || null
    const whatsapp = c.whatsapp?.trim() || null
    const nome = c.nome?.trim() || null

    if (!email && !whatsapp) {
      resultados.push({ contato: c, ok: false, motivo: 'sem email e sem whatsapp' })
      continue
    }

    // grava o contato (status ativo, etapa 0)
    const { data: inserido, error: errInsert } = await supabaseAdmin
      .from('captacao_fornecedores')
      .insert({
        nome,
        email,
        whatsapp,
        segmento,
        etapa: 0,
        status: 'ativo',
        canal_email: canalEmail,
        canal_whatsapp: canalWhatsapp,
        ator: 'admin',
      })
      .select()
      .single()

    if (errInsert || !inserido) {
      // provavelmente e-mail duplicado (índice único)
      resultados.push({ contato: c, ok: false, motivo: errInsert?.message ?? 'falha ao inserir' })
      continue
    }

    // dispara o convite agora (await obrigatório)
    const envio = await dispararToqueCaptacao({
      id: inserido.id,
      nome,
      email,
      whatsapp,
      segmento,
      etapa: 0,
      canal_email: canalEmail,
      canal_whatsapp: canalWhatsapp,
    })

    // agenda follow-up 1 (dia +5) ou encerra
    const { proximoEnvioEm } = proximoAgendamento(0)
    const agoraISO = new Date().toISOString()

    await supabaseAdmin
      .from('captacao_fornecedores')
      .update({
        // a etapa 0 (convite) já foi enviada; o próximo toque será a etapa 1
        ultimo_envio_em: agoraISO,
        proximo_envio_em: proximoEnvioEm,
        status: proximoEnvioEm ? 'ativo' : 'esgotado',
        atualizado_em: agoraISO,
        ...(envio.enviouAlgo ? {} : { erros: 1, ultimo_erro: 'falha no convite' }),
      })
      .eq('id', inserido.id)

    resultados.push({
      contato: c,
      ok: envio.enviouAlgo,
      email: envio.emailOk,
      whatsapp: envio.whatsappOk,
    })
  }

  return NextResponse.json({ resultados })
}

export async function GET(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'nao autorizado' }, { status: 401 })
  }

  const { data } = await supabaseAdmin
    .from('captacao_fornecedores')
    .select('*')
    .order('criado_em', { ascending: false })
    .limit(500)

  return NextResponse.json({ dados: data ?? [] })
}
