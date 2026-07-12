// app/api/admin/whatsapp/criar-templates-retomada/route.ts
// ============================================================================
// POST (admin) — cria os templates de RETOMADA na WABA, via Graph API.
// One-shot: rode uma vez; a Meta coloca em análise. Reexecutar é seguro
// (nome duplicado é rejeitado pela Meta, sem duplicar).
//
// v3: botão "Continuar meu pedido" com URL DINÂMICA — na hora do envio o
// inbox injeta o id do pedido do contato e cada cliente cai direto no
// PRÓPRIO pedido (visualizador/{{1}}), não mais na home. O corpo segue
// personalizado com o nome ({{1}}). Substitui retomar_pedido_v2 (botão
// fixo pra home), que fica pra descartar quando a v3 for aprovada.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v23.0'

// Botão com URL dinâmica: a Meta substitui {{1}} pelo parâmetro enviado na
// hora do disparo (id do pedido + UTMs). O exemplo precisa ser uma URL real.
const URL_VISUALIZADOR_DINAMICA = 'https://www.confeccione.com.br/visualizador/{{1}}'
const EXEMPLO_VISUALIZADOR =
  'https://www.confeccione.com.br/visualizador/a1591a0f-007e-4e0d-a299-582138cc9bad'

const TEMPLATES = [
  {
    name: 'retomar_pedido_v3',
    language: 'pt_BR',
    category: 'MARKETING',
    components: [
      {
        type: 'BODY',
        text:
          'Oi, {{1}}! 👋 Vi que você começou um pedido aqui na Confeccione e ele ficou salvo no meio do caminho. Toca no botão pra abrir o seu pedido e continuar de onde parou — leva menos de 2 minutos. 🧵',
        example: { body_text: [['Ana']] },
      },
      { type: 'FOOTER', text: 'Confeccione · confeccione.com.br' },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'URL',
            text: 'Continuar meu pedido',
            url: URL_VISUALIZADOR_DINAMICA,
            example: [EXEMPLO_VISUALIZADOR],
          },
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
