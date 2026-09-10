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
import { templateDuvidaPedidoAgora, TEMPLATES_DUVIDA_PEDIDO } from '@/app/lib/whatsapp-templates'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POR QUE NÃO USAMOS MAIS O `sondagem_producao` AQUI — 10/09/2026
//
// Ele é MARKETING, e a Meta recusa marketing pra quem nunca escreveu pra gente.
// A prova é do mesmo dia e da mesma pessoa: a Lucilaine levou `sondagem_producao`
// às 06:17 e 06:18 (as duas recusadas, "healthy ecosystem engagement") e
// `duvida_pedido_manha` às 06:24 — ENTREGUE. Mesma manhã, mesmo número, mesmo
// destinatário sem histórico. O que mudou foi a categoria: UTILITY passa.
//
// O texto ("Sobre seu pedido na Confeccione, posso tirar uma dúvida?") nasceu
// pra cliente e serve de empréstimo aqui: ele abre a conversa, que é tudo o que
// precisamos — quando ela responde, a janela de 24 h abre e o Luigi conduz em
// texto livre, sem template nenhum.
//
// É EMPRÉSTIMO, NÃO SOLUÇÃO. Template UTILITY tem que falar de uma transação da
// pessoa, e confecção não tem pedido; a Meta pode reclassificar na revisão e aí
// a tarifa vira a de marketing (R$ 0,3217 contra R$ 0,035) e o bloqueio volta.
// Vale enquanto o UTILITY próprio de fornecedor não é aprovado.
const TEMPLATE_ABORDAGEM = templateDuvidaPedidoAgora

/** Qualquer um destes já é "a gente abordou" — a trava conta todos. */
const TEMPLATES_DE_ABORDAGEM = [
  'sondagem_producao',
  TEMPLATES_DUVIDA_PEDIDO.manha,
  TEMPLATES_DUVIDA_PEDIDO.tarde,
  TEMPLATES_DUVIDA_PEDIDO.noite,
]

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
  // TRÊS CONSULTAS SIMPLES EM VEZ DE UM FILTRO ANINHADO — 10/09/2026.
  //
  // A primeira versão filtrava por `wa_conversas.wa_contatos.wa_id` num embed
  // duplo do PostgREST. Não pegou: a Lucilaine recebeu a mesma sondagem às 06:17
  // e às 06:18. Filtro aninhado que falha não dá erro, só devolve nada — e
  // "nada" aqui significa "pode mandar". Trava que falha em silêncio é pior que
  // trava nenhuma, porque a gente confia nela.
  const fim8 = waId.replace(/\D/g, '').slice(-8)
  const { data: contatos } = await supabaseAdmin.from('wa_contatos').select('id').ilike('wa_id', `%${fim8}`)
  const idsContato = (contatos ?? []).map((c) => c.id as string)
  if (idsContato.length > 0) {
    const { data: conversas } = await supabaseAdmin.from('wa_conversas').select('id').in('contato_id', idsContato)
    const idsConversa = (conversas ?? []).map((c) => c.id as string)
    if (idsConversa.length > 0) {
      const { data: jaMandou } = await supabaseAdmin
        .from('wa_mensagens')
        .select('criado_em, status')
        .in('conversa_id', idsConversa)
        .eq('direcao', 'saida')
        .in('template_nome', TEMPLATES_DE_ABORDAGEM)
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle<{ criado_em: string; status: string | null }>()
      if (jaMandou) {
        const quando = new Date(jaMandou.criado_em).toLocaleString('pt-BR', {
          timeZone: 'America/Recife', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
        })
        // Entrega recusada pela Meta merece explicação diferente: reenviar não
        // resolve, porque o bloqueio é do lado de quem recebe.
        const motivo =
          jaMandou.status === 'falhou'
            ? `A abordagem de ${quando} foi recusada pela Meta. Agora usamos template UTILITY, que passa mesmo pra quem nunca escreveu — vale tentar de novo depois de 24 h, ou peça pra ela mandar um "oi" no nosso número.`
            : `Já abordamos ela em ${quando}. Se não respondeu, insistir vira spam.`
        return NextResponse.json({ erro: motivo }, { status: 409 })
      }
    }
  }

  const template = TEMPLATE_ABORDAGEM()
  const r = await enviarTemplate(waId, template, 'pt_BR', [
    { type: 'body', parameters: [{ type: 'text', text: primeiroNome }] },
  ])
  if (!r.ok) return NextResponse.json({ erro: `A Meta recusou: ${r.erro}` }, { status: 502 })

  // registrarSaidaInbox cria contato e conversa se não existirem.
  await registrarSaidaInbox(waId, f.nome, r.wamid, `[template] ${template}`, template, 'mcp')

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
