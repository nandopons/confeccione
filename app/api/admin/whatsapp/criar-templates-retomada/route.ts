// app/api/admin/whatsapp/criar-templates-retomada/route.ts
// ============================================================================
// POST (admin) — cria/atualiza os templates de RETOMADA personalizados com o
// nome do cliente ({{1}}) na WABA, via Graph API. One-shot: rode uma vez; a
// Meta coloca em análise. Reexecutar é seguro (nome duplicado é rejeitado pela
// Meta, sem duplicar).
//
// Personaliza retomar_conversa_v2 e retomar_pedido_v2 — versões com nome das
// mensagens sem nome (que ficam pra descartar quando estas forem aprovadas).
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v23.0'

// URL do botão "Continuar meu pedido" — homepage com UTMs (o funil lê utm_source).
const URL_RETOMAR =
  'https://www.confeccione.com.br/?utm_source=whatsapp&utm_medium=template&utm_campaign=retomar_pedido'

const TEMPLATES = [
  {
    name: 'retomar_conversa_v2',
    language: 'pt_BR',
    category: 'MARKETING',
    components: [
      {
        type: 'BODY',
        text:
          'Oi, {{1}}! Aqui é da Confeccione 😊 A gente ainda pode te ajudar a tirar a produção das suas peças do papel. Quer retomar a conversa?',
        example: { body_text: [['Ana']] },
      },
      { type: 'FOOTER', text: 'Responda e a gente continua por aqui' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Quero retomar' },
          { type: 'QUICK_REPLY', text: 'Falar com atendente' },
        ],
      },
    ],
  },
  {
    name: 'retomar_pedido_v2',
    language: 'pt_BR',
    category: 'MARKETING',
    components: [
      {
        type: 'BODY',
        text:
          'Oi, {{1}}! 👋 Vi que você começou um pedido aqui na Confeccione e ele ficou salvo no meio do caminho. Dá pra continuar de onde parou — leva menos de 2 minutos. 🧵',
        example: { body_text: [['Ana']] },
      },
      { type: 'FOOTER', text: 'Confeccione · confeccione.com.br' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'URL', text: 'Continuar meu pedido', url: URL_RETOMAR },
          { type: 'QUICK_REPLY', text: 'Falar com atendente' },
        ],
      },
    ],
  },
]

export async function POST(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  }

  const token = process.env.WHATSAPP_TOKEN
  const wabaId = process.env.WHATSAPP_WABA_ID
  if (!token || !wabaId) {
    return NextResponse.json({ erro: 'WHATSAPP_TOKEN/WHATSAPP_WABA_ID ausentes' }, { status: 500 })
  }

  const resultados: Array<{ nome: string; ok: boolean; id?: string; status?: string; erro?: string }> = []

  for (const tpl of TEMPLATES) {
    try {
      const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/message_templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(tpl),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        resultados.push({ nome: tpl.name, ok: false, erro: data?.error?.message || `HTTP ${res.status}` })
      } else {
        resultados.push({ nome: tpl.name, ok: true, id: data?.id, status: data?.status })
      }
    } catch (err) {
      resultados.push({ nome: tpl.name, ok: false, erro: err instanceof Error ? err.message : String(err) })
    }
  }

  const criados = resultados.filter((r) => r.ok).length
  return NextResponse.json({ ok: true, criados, total: TEMPLATES.length, resultados })
}
