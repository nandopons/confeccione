// app/api/admin/whatsapp/criar-templates-retomada/route.ts
// ============================================================================
// POST (admin) — cria os templates de RETOMADA na WABA, via Graph API.
// One-shot: rode uma vez; a Meta coloca em análise. Reexecutar é seguro
// (nome duplicado é rejeitado pela Meta, sem duplicar).
//
// Templates criados: oferta_pedido (oferta ao fornecedor com botão), 
// pedido_recebido_v2 (confirmação com botão pro painel), codigo_acesso
// (OTP de login) e retomar_pedido_v3 (marketing de retomada).
//
// v3: botão "Continuar meu pedido" com URL DINÂMICA — na hora do envio o
// inbox injeta o id do pedido do contato e cada cliente cai direto no
// PRÓPRIO pedido (visualizador/{{1}}), não mais na home. O corpo segue
// personalizado com o nome ({{1}}). Substitui retomar_pedido_v2 (botão
// fixo pra home), que fica pra descartar quando a v3 for aprovada.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { uploadHeaderHandle } from '@/app/lib/meta-upload'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v23.0'

// Botão com URL dinâmica: a Meta substitui {{1}} pelo parâmetro enviado na
// hora do disparo (id do pedido + UTMs). O exemplo precisa ser uma URL real.
const URL_VISUALIZADOR_DINAMICA = 'https://www.confeccione.com.br/visualizador/{{1}}'
const EXEMPLO_VISUALIZADOR =
  'https://www.confeccione.com.br/visualizador/a1591a0f-007e-4e0d-a299-582138cc9bad'

/** Mockup público de um pedido real (corta-vento do Big Shopp) — só pro exemplo do cabeçalho. */
const EXEMPLO_IMAGEM_SONDAGEM =
  'https://www.confeccione.com.br/api/pedido/assistente/0a468895-a9f9-4171-9ce3-b5f0229af2ff/arquivo?f=59e1e2124886544257b699000488f77c.jpg'

const TEMPLATES = [
  // Confirmar pedido (marketing) — lembrete pro cliente que parou no caminho.
  // Copy curta e pessoal, sem emoji, sem link no texto: botão URL "Concluir
  // pedido" (visualizador/{{1}}) + quick reply "Falar com atendente". Substitui
  // retomar_pedido_v3 quando aprovado: basta WHATSAPP_TEMPLATE_RETOMADA=
  // confirmar_pedido_v1 no env (ver whatsapp-cloud.ts), sem deploy.
  {
    name: 'confirmar_pedido_v1',
    language: 'pt_BR',
    category: 'MARKETING',
    components: [
      {
        type: 'BODY',
        text: 'Oi, {{1}}. Seu pedido na Confeccione ficou salvo, do jeito que você montou. Gostaria de confirmar seu pedido?',
        example: { body_text: [['Ana']] },
      },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'URL', text: 'Concluir pedido', url: URL_VISUALIZADOR_DINAMICA, example: [EXEMPLO_VISUALIZADOR] },
          { type: 'QUICK_REPLY', text: 'Falar com atendente' },
        ],
      },
    ],
  },
  // Feedback da negociação (utility) — depois que um fornecedor aceita, o
  // admin pergunta ao CLIENTE se está sendo bem atendido. Dois quick replies;
  // o payload volta pelo webhook e "Quero outro fornecedor" reabre o pedido.
  {
    name: 'feedback_negociacao',
    language: 'pt_BR',
    category: 'UTILITY',
    allow_category_change: false,
    components: [
      {
        type: 'BODY',
        text: 'Oi, {{1}}! Seu pedido na Confeccione está com {{2}}. Como está a conversa com eles — foi bem atendido?',
        example: { body_text: [['Ana', 'Malharia Recife']] },
      },
      { type: 'FOOTER', text: 'Confeccione · confeccione.com.br' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Sim, tudo bem' },
          { type: 'QUICK_REPLY', text: 'Quero outro fornecedor' },
        ],
      },
    ],
  },
  // Atualização genérica de pedido (utility) — fallback oficial pra QUALQUER
  // aviso transacional fora da janela de 24h. O sufixo do botão é o caminho
  // completo no site (visualizador/…, fornecedor/oferta/…, fornecedor/painel).
  {
    name: 'pedido_atualizacao',
    language: 'pt_BR',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text:
          'Oi, {{1}}! Atualização do seu pedido na Confeccione: {{2}}. Toque no botão pra ver os detalhes e continuar por lá.',
        example: { body_text: [['Ana', 'Pagamento confirmado — produção liberada']] },
      },
      { type: 'FOOTER', text: 'Confeccione · confeccione.com.br' },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'URL',
            text: 'Ver detalhes',
            url: 'https://www.confeccione.com.br/{{1}}',
            example: ['https://www.confeccione.com.br/visualizador/a1591a0f-007e-4e0d-a299-582138cc9bad'],
          },
        ],
      },
    ],
  },
  // Oferta de pedido ao FORNECEDOR (utility) — botão dinâmico pra página da
  // oferta (fornecedor/oferta/{{1}}). Sem contato do cliente (contrato de
  // privacidade: contato só após o aceite).
  {
    name: 'oferta_pedido',
    language: 'pt_BR',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text:
          'Oi, {{1}}! 🧵 Tem pedido disponível pra você na Confeccione: {{2}} — {{3}}. Toque no botão pra ver os mockups e assumir (é por ordem de chegada). Pagamento garantido pela Confeccione, liberado após a entrega em conformidade.',
        example: { body_text: [['Ana', '50x camiseta preta · 50 peças', 'prazo 21 dias · repasse R$ 2.500,00']] },
      },
      { type: 'FOOTER', text: 'Confeccione · confeccione.com.br' },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'URL',
            text: 'Ver e assumir pedido',
            url: 'https://www.confeccione.com.br/fornecedor/oferta/{{1}}',
            example: ['https://www.confeccione.com.br/fornecedor/oferta/12a6aef5-5042-4927-9a68-2276777563d1'],
          },
        ],
      },
    ],
  },
  // Oferta ao FORNECEDOR v2 — a v1 (oferta_pedido) foi recategorizada pela
  // Meta como MARKETING, e mensagem de marketing é suprimida pra números em
  // experimento/limite da Meta ("User's number is part of an experiment" /
  // "healthy ecosystem engagement") — caso real: Dom Santo, 15/07/2026, 5
  // ofertas seguradas. Copy seca e vinculada ao cadastro do fornecedor, sem
  // tom promocional, e com allow_category_change: false — se a Meta discordar
  // de UTILITY ela REJEITA (a gente itera o texto) em vez de virar marketing
  // em silêncio.
  {
    name: 'oferta_pedido_v2',
    language: 'pt_BR',
    category: 'UTILITY',
    allow_category_change: false,
    components: [
      {
        type: 'BODY',
        text:
          'Oi, {{1}}! Há um pedido aguardando sua resposta no seu cadastro de fornecedor da Confeccione: {{2}} — {{3}}. Acesse pra ver os detalhes e aceitar ou recusar o atendimento.',
        example: { body_text: [['Ana', '50x camiseta preta · 50 peças', 'prazo 21 dias · repasse R$ 2.500,00']] },
      },
      { type: 'FOOTER', text: 'Confeccione · confeccione.com.br' },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'URL',
            text: 'Responder ao pedido',
            url: 'https://www.confeccione.com.br/fornecedor/oferta/{{1}}',
            example: ['https://www.confeccione.com.br/fornecedor/oferta/12a6aef5-5042-4927-9a68-2276777563d1'],
          },
        ],
      },
    ],
  },
  // Oferta ao fornecedor v4 (04/09/2026) — FICHA SECA.
  // A v2 era um parágrafo com saudação e explicação; o fornecedor lê no celular,
  // quase sempre no meio da produção, e decide por quantidade, estado e prazo.
  // Aqui cada dado tem sua linha e o texto em volta some — é o mesmo formato do
  // texto livre antigo do Z-API, que era o que funcionava. O corpo NÃO pode
  // começar nem terminar com variável (a Meta rejeita) — daí o "Novo pedido:" na
  // primeira linha e a pergunta fechando a mensagem.
  //
  // v3 existiu por algumas horas com outra copy: a Meta não deixa editar
  // template em análise, e apagar bloqueia o nome por 30 dias. Por isso v4.
  {
    name: 'oferta_pedido_v4',
    language: 'pt_BR',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text:
          'Novo pedido:\n\nTipo: {{1}}\nQuantidade: {{2}}\nEstado: {{3}}\nPrazo: {{4}}\nDetalhes: {{5}}\n\nQuer atender este cliente? Toque em Ver pedido.',
        example: {
          body_text: [['Bonés', '10 peças', 'PE', '15 dias', 'Bonés azuis, bordado frontal']],
        },
      },
      { type: 'FOOTER', text: 'Confeccione · confeccione.com.br' },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'URL',
            text: 'Ver pedido',
            url: 'https://www.confeccione.com.br/fornecedor/oferta/{{1}}',
            example: ['https://www.confeccione.com.br/fornecedor/oferta/12a6aef5-5042-4927-9a68-2276777563d1'],
          },
        ],
      },
    ],
  },
  // Oferta ao fornecedor v5 (28/09/2026) — a v4 SEM a linha "Detalhes:".
  // O Fernando viu a ficha no celular: os detalhes viravam um parágrafo (cor ·
  // tecido · estampa · descrição por linha) e escondiam o que decide o aceite.
  // Fica só tipo, quantidade, estado e prazo; o resto está no botão.
  {
    name: 'oferta_pedido_v5',
    language: 'pt_BR',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text:
          'Novo pedido:\n\nTipo: {{1}}\nQuantidade: {{2}}\nEstado: {{3}}\nPrazo: {{4}}\n\nQuer atender este cliente? Toque em Ver pedido.',
        example: {
          body_text: [['Bonés', '10 peças', 'PE', '15 dias']],
        },
      },
      { type: 'FOOTER', text: 'Confeccione · confeccione.com.br' },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'URL',
            text: 'Ver pedido',
            url: 'https://www.confeccione.com.br/fornecedor/oferta/{{1}}',
            example: ['https://www.confeccione.com.br/fornecedor/oferta/12a6aef5-5042-4927-9a68-2276777563d1'],
          },
        ],
      },
    ],
  },
  // Confirmação de pedido (utility) — botão dinâmico pro painel do cliente
  // com o e-mail pré-preenchido (login?email={{1}}).
  {
    name: 'pedido_recebido_v2',
    language: 'pt_BR',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text:
          'Oi, {{1}}! Recebemos seu pedido nº {{2}} aqui na Confeccione. ✅ Nossa equipe já está buscando o fornecedor ideal pra sua produção. Acompanhe o andamento e fale com a gente pelo seu painel — é só tocar no botão abaixo.',
        example: { body_text: [['Ana', '20260700110']] },
      },
      { type: 'FOOTER', text: 'Confeccione · confeccione.com.br' },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'URL',
            text: 'Acompanhar meu pedido',
            url: 'https://www.confeccione.com.br/cliente/login?email={{1}}',
            example: ['https://www.confeccione.com.br/cliente/login?email=ana%40email.com'],
          },
          { type: 'QUICK_REPLY', text: 'Falar com atendente' },
        ],
      },
    ],
  },
  // Código de acesso (authentication) — formato fixo da Meta com botão
  // "copiar código". Corpo/rodapé são gerados pela Meta.
  {
    name: 'codigo_acesso',
    language: 'pt_BR',
    category: 'AUTHENTICATION',
    components: [
      { type: 'BODY', add_security_recommendation: true },
      { type: 'FOOTER', code_expiration_minutes: 10 },
      {
        type: 'BUTTONS',
        buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copiar código' }],
      },
    ],
  },
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

  // SONDAGEM COM FOTO — 29/09/2026 (decisão do Fernando). No lugar de "Luigi,
  // da Confeccione, de Recife", a abordagem é a foto de um modelo do pedido
  // com "Vocês produzem {{1}} nesse estilo?". Cabeçalho IMAGE exige um exemplo
  // subido pelo upload resumable (meta-upload.ts); montado aqui na hora.
  const lista: Array<Record<string, unknown>> = [
    ...TEMPLATES,
    // SONDAGEM SEM APRESENTAÇÃO — 29/09/2026 (decisão do Fernando): "esse
    // início também pode morrer, coloca só: gostaria de tirar uma dúvida
    // sobre uma produção com vocês". Sem nome, sem "aqui é o Luigi". É o
    // fallback da sondagem com foto quando o pedido não tem imagem.
    {
      name: 'sondagem_v2',
      language: 'pt_BR',
      category: 'MARKETING',
      components: [{ type: 'BODY', text: 'Gostaria de tirar uma dúvida sobre uma produção com vocês' }],
    },
  ]
  try {
    const exemplo = await fetch(EXEMPLO_IMAGEM_SONDAGEM)
    if (!exemplo.ok) throw new Error(`imagem de exemplo: HTTP ${exemplo.status}`)
    const bytes = Buffer.from(await exemplo.arrayBuffer())
    const handle = await uploadHeaderHandle(bytes, exemplo.headers.get('content-type') || 'image/jpeg')
    lista.push({
      name: 'sondagem_foto_v1',
      language: 'pt_BR',
      category: 'MARKETING',
      components: [
        { type: 'HEADER', format: 'IMAGE', example: { header_handle: [handle] } },
        { type: 'BODY', text: 'Vocês produzem {{1}} nesse estilo?', example: { body_text: [['corta-vento com touca']] } },
      ],
    })
  } catch (err) {
    resultados.push({ nome: 'sondagem_foto_v1', ok: false, erro: `exemplo de imagem: ${err instanceof Error ? err.message : String(err)}` })
  }

  for (const tpl of lista) {
    try {
      const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/message_templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(tpl),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        resultados.push({ nome: String(tpl.name), ok: false, erro: data?.error?.message || `HTTP ${res.status}` })
      } else {
        resultados.push({ nome: String(tpl.name), ok: true, id: data?.id, status: data?.status })
      }
    } catch (err) {
      resultados.push({ nome: String(tpl.name), ok: false, erro: err instanceof Error ? err.message : String(err) })
    }
  }

  const criados = resultados.filter((r) => r.ok).length
  return NextResponse.json({ ok: true, criados, total: lista.length, resultados })
}
