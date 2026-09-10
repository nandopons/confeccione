// app/api/admin/fornecedores/[id]/sondar/route.ts
// ============================================================================
// "Conversar antes de aprovar" — o botão da tela de Aprovações.
//
// A ORDEM ESTAVA INVERTIDA. Aprovava-se pelo formulário e a conversa vinha
// depois, se viesse. O cadastro diz pouco: em 10/09/2026, 39 de 42 fornecedores
// aprovados tinham só categoria ("fitness", "private_label"), que não casa com
// pedido nenhum. A Rafaelle foi aprovada dizendo "interclasse" e faz bainha.
//
// Agora dá pra conversar ANTES: o Luigi abre a janela, explica a plataforma,
// pergunta o que ela produz de verdade e grava no perfil. Você aprova lendo o
// que ela respondeu, não o que ela marcou num formulário.
//
// COMO A JANELA ABRE: quem acabou de se cadastrar nunca escreveu pra gente, e
// fora da janela de 24 h a Meta só aceita template. Então isto manda o
// `sondagem_producao` (aprovado) e para. Quando ela responder, o webhook chama
// o Luigi, que já reconhece o número como fornecedor e conduz o resto sozinho.
//
// NÃO APROVA NADA. O status continua 'pendente' — a decisão é sua, depois de ler.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { enviarTemplate, normalizarWaId } from '@/app/lib/whatsapp-cloud'
import { registrarSaidaInbox } from '@/app/lib/whatsapp-notify'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TEMPLATE_SONDAGEM = 'sondagem_producao'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  }
  const { id } = await ctx.params

  const { data: f } = await supabaseAdmin
    .from('leads_fornecedores')
    .select('id, nome, whatsapp, aprovacao_status')
    .eq('id', id)
    .maybeSingle<{ id: string; nome: string | null; whatsapp: string | null; aprovacao_status: string | null }>()
  if (!f) return NextResponse.json({ erro: 'Fornecedor não encontrado' }, { status: 404 })
  if (!f.whatsapp) return NextResponse.json({ erro: 'Esse cadastro não tem WhatsApp' }, { status: 400 })

  const waId = normalizarWaId(f.whatsapp)
  const primeiroNome = (f.nome ?? '').trim().split(/\s+/)[0] || 'tudo bem'

  // UMA VEZ SÓ: se já mandamos a sondagem e ela não respondeu, insistir é spam e
  // derruba a qualidade do número na Meta. A busca casa pelos últimos 8 dígitos
  // por causa do nono dígito — o mesmo número aparece com 12 ou 13.
  const fim8 = waId.replace(/\D/g, '').slice(-8)
  const { data: jaMandou } = await supabaseAdmin
    .from('wa_mensagens')
    .select('criado_em, wa_conversas!inner(wa_contatos!inner(wa_id))')
    .eq('direcao', 'saida')
    .eq('template_nome', TEMPLATE_SONDAGEM)
    .ilike('wa_conversas.wa_contatos.wa_id', `%${fim8}`)
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle<{ criado_em: string }>()
  if (jaMandou) {
    const quando = new Date(jaMandou.criado_em).toLocaleString('pt-BR', {
      timeZone: 'America/Recife', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    })
    return NextResponse.json(
      { erro: `A sondagem já foi enviada em ${quando}. Se ela não respondeu, insistir vira spam.` },
      { status: 409 },
    )
  }

  const r = await enviarTemplate(waId, TEMPLATE_SONDAGEM, 'pt_BR', [
    { type: 'body', parameters: [{ type: 'text', text: primeiroNome }] },
  ])
  if (!r.ok) return NextResponse.json({ erro: `A Meta recusou: ${r.erro}` }, { status: 502 })

  // registrarSaidaInbox cria contato e conversa se não existirem.
  await registrarSaidaInbox(waId, f.nome, r.wamid, `[template] ${TEMPLATE_SONDAGEM}`, TEMPLATE_SONDAGEM, 'mcp')

  // O fornecedor_id é o que faz o Luigi usar o prompt de CONFECÇÃO em vez do de
  // cliente quando ela responder. Sem isto ele trata a dona da fábrica como
  // alguém querendo comprar roupa — foi o que aconteceu com a Marilia em 09/09.
  await supabaseAdmin
    .from('wa_contatos')
    .update({ fornecedor_id: f.id, atualizado_em: new Date().toISOString() })
    .ilike('wa_id', `%${fim8}`)

  return NextResponse.json({
    ok: true,
    aviso: 'Sondagem enviada. Quando ela responder, o Luigi assume, explica a plataforma e levanta o perfil de produção.',
  })
}
