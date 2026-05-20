// app/api/cliente/pedido/[id]/compartilhar-artes/route.ts
// ============================================================================
// POST /api/cliente/pedido/[id]/compartilhar-artes
//
// Gera um link público temporário (7 dias) com os arquivos do repositório da
// conta e dispara pro WhatsApp do fornecedor aceito neste pedido.
//
// Fluxo:
//   1. Auth + ownership (pedido pertence à conta logada)
//   2. Bloqueia status terminal → 422
//   3. Bloqueia se não há fornecedor aceito → 422
//   4. Bloqueia se repositório vazio → 422
//   5. Gera link_token (24 bytes base64url), expira em 7d, INSERT do registro
//   6. AWAIT Z-API pro WhatsApp do fornecedor (Vercel mata o processo após retorno)
//   7. audit_log 'pedido.compartilhar_artes'
//   8. Retorna { ok, compartilhamento_id, link_token, arquivos_count, expira_em }
//
// Privacidade: a mensagem ao fornecedor NÃO inclui contato/nome do cliente.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { getContaAtual } from '@/app/lib/cliente-auth'
import { registrarAudit } from '@/app/lib/audit'
import { enviarMensagem } from '@/app/lib/zapi'
import { listarArquivos } from '@/app/lib/arquivos-cliente'

export const dynamic = 'force-dynamic'

const STATUS_TERMINAL = [
  'concluido',
  'expirado_sem_resposta',
  'manual_pausado',
] as const

const LINK_VALIDADE_DIAS = 7

type Pedido = {
  id: string
  conta_id: string | null
  status: string
  fornecedor_aceito_id: string | null
  fornecedor_aceito?: { nome: string | null; whatsapp: string } | null
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const conta = await getContaAtual()
  if (!conta) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  const { id: pedidoId } = await params

  // 1. Pedido + ownership
  const { data: pedidoRaw } = await supabaseAdmin
    .from('pedidos')
    .select(
      'id, conta_id, status, fornecedor_aceito_id, ' +
        'fornecedor_aceito:leads_fornecedores!fornecedor_aceito_id(nome, whatsapp)',
    )
    .eq('id', pedidoId)
    .maybeSingle()

  const pedido = pedidoRaw as unknown as Pedido | null
  if (!pedido || pedido.conta_id !== conta.id) {
    // Não vaza existência
    return NextResponse.json({ erro: 'Pedido não encontrado' }, { status: 404 })
  }

  // 2. Status terminal
  if ((STATUS_TERMINAL as readonly string[]).includes(pedido.status)) {
    return NextResponse.json(
      { erro: 'Este pedido já foi encerrado', status_atual: pedido.status },
      { status: 422 },
    )
  }

  // 3. Precisa de fornecedor aceito
  if (!pedido.fornecedor_aceito_id || !pedido.fornecedor_aceito) {
    return NextResponse.json(
      { erro: 'Este pedido ainda não tem fornecedor para compartilhar' },
      { status: 422 },
    )
  }

  // 4. Repositório não pode estar vazio
  const { arquivos, usadoBytes } = await listarArquivos(conta.id)
  if (arquivos.length === 0) {
    return NextResponse.json(
      { erro: 'Seu repositório está vazio. Envie arquivos antes de compartilhar.' },
      { status: 422 },
    )
  }

  // 5. Cria o compartilhamento
  const linkToken = randomBytes(24).toString('base64url')
  const expiraEm = new Date(
    Date.now() + LINK_VALIDADE_DIAS * 24 * 60 * 60 * 1000,
  ).toISOString()

  const { data: comp, error: errComp } = await supabaseAdmin
    .from('compartilhamentos_artes')
    .insert({
      pedido_id: pedidoId,
      conta_id: conta.id,
      fornecedor_id: pedido.fornecedor_aceito_id,
      link_token: linkToken,
      arquivos_count: arquivos.length,
      bytes_total: usadoBytes,
      expira_em: expiraEm,
    })
    .select('id')
    .single()

  if (errComp || !comp) {
    console.error('[compartilhar-artes] insert falhou:', errComp)
    return NextResponse.json({ erro: 'Erro ao processar' }, { status: 500 })
  }

  // 6. Dispara WhatsApp pro fornecedor (AWAIT — sem contato do cliente)
  const linkPublico = `${req.nextUrl.origin}/artes/${linkToken}`
  const saudacao = pedido.fornecedor_aceito.nome
    ? `Olá, ${pedido.fornecedor_aceito.nome}!`
    : 'Olá!'
  const plural = arquivos.length === 1 ? 'arquivo' : 'arquivos'
  const mensagem =
    `🎨 *Confeccione — Artes do pedido*\n\n` +
    `${saudacao}\n\n` +
    `O cliente compartilhou ${arquivos.length} ${plural} com você para este pedido.\n\n` +
    `Acesse (link válido por ${LINK_VALIDADE_DIAS} dias):\n${linkPublico}`

  const whatsappEnviado = await enviarMensagem(
    pedido.fornecedor_aceito.whatsapp,
    mensagem,
  )

  // 7. Audit
  await registrarAudit({
    ator: `cliente:${conta.id}`,
    acao: 'pedido.compartilhar_artes',
    entidade_tipo: 'pedidos',
    entidade_id: pedidoId,
    metadata: {
      compartilhamento_id: comp.id,
      fornecedor_id: pedido.fornecedor_aceito_id,
      arquivos_count: arquivos.length,
      bytes_total: usadoBytes,
      whatsapp_enviado: whatsappEnviado,
      expira_em: expiraEm,
      user_agent: req.headers.get('user-agent') ?? null,
    },
  })

  // 8. Retorno
  return NextResponse.json({
    ok: true,
    compartilhamento_id: comp.id,
    link_token: linkToken,
    arquivos_count: arquivos.length,
    expira_em: expiraEm,
    whatsapp_enviado: whatsappEnviado,
  })
}
