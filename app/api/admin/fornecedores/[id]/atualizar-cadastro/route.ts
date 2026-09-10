// app/api/admin/fornecedores/[id]/atualizar-cadastro/route.ts
// ============================================================================
// "Atualizar cadastro" — o botão da tabela de fornecedores APROVADOS.
//
// O cadastro envelhece. A confecção marcou "fitness" em março, hoje faz jaleco
// e scrub; o portfólio dela tem foto nova que a gente nunca viu. Nada disso
// aparece sozinho — em 10/09/2026, 39 de 42 aprovados tinham só categoria
// gravada, que não casa com pedido nenhum.
//
// Este botão manda o Luigi puxar esse assunto: o que vocês estão produzindo
// hoje, e tem foto nova? Ele grava direto no perfil de produção.
//
// POR QUE A ROTA DECIDE ENTRE TRÊS CAMINHOS
// Não dá pra simplesmente "mandar mensagem". Fora da janela de 24 h a Meta só
// aceita template, e template de marketing pra quem NUNCA escreveu ela recusa
// (erro 131049 — foi o que aconteceu com a Lucilaine em 10/09). Entre os 42
// aprovados, 31 nunca escreveram. Mandar template pros 31 seria levar 31
// recusas e derrubar a qualidade do número — por um botão que parece inofensivo.
//
// Então:
//   janela aberta        → o Luigi fala agora, texto livre, sem template.
//   já escreveu um dia   → template de sondagem; quando ela responder, o Luigi
//                          assume (o `fornecedor_id` no contato garante que ele
//                          use o prompt de confecção, e não o de cliente).
//   nunca escreveu       → NÃO manda nada. Devolve 409 explicando que a Meta vai
//                          recusar e que o caminho é o e-mail com o link.
//
// A recusa é o ponto: um botão que "funciona" mandando o que vai ser bloqueado
// é pior que um botão que diz não.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { enviarTemplate, normalizarWaId } from '@/app/lib/whatsapp-cloud'
import { registrarSaidaInbox } from '@/app/lib/whatsapp-notify'
import { devolverAoLuigi } from '@/app/lib/luigi'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TEMPLATE_SONDAGEM = 'sondagem_producao'

/** Duas abordagens na mesma semana é assédio, não follow-up. */
const CARENCIA_DIAS = 30

/**
 * O que o Luigi tem que fazer ao reabrir a boca nesta conversa.
 *
 * Escrito como recado do Fernando pra ele, não como script: se virar roteiro,
 * ele lê o roteiro em voz alta e a confecção sente o robô do outro lado.
 */
const RETOMADA_ATUALIZAR =
  'Puxe assunto com esta confecção pra atualizar o cadastro dela. ' +
  'Duas coisas, nesta ordem: (1) o que ela está produzindo HOJE — peça com nome, ' +
  'não categoria; se ela responder por categoria, dê as opções concretas. ' +
  '(2) foto de produção recente, se ela tiver. ' +
  'Grave no perfil com salvar_perfil_producao assim que tiver peça com nome. ' +
  'Ela JÁ É aprovada e já recebe pedidos — não trate como cadastro novo nem ' +
  'explique a plataforma do zero. Comece reconhecendo que já trabalham juntos. ' +
  'Uma mensagem por vez, e nunca pergunte prazo de produção: prazo é do pedido.'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  }
  const { id } = await ctx.params

  const { data: f } = await supabaseAdmin
    .from('leads_fornecedores')
    .select('id, nome, whatsapp, email, aprovacao_status')
    .eq('id', id)
    .maybeSingle<{
      id: string
      nome: string | null
      whatsapp: string | null
      email: string | null
      aprovacao_status: string | null
    }>()
  if (!f) return NextResponse.json({ erro: 'Fornecedor não encontrado' }, { status: 404 })
  if (!f.whatsapp) return NextResponse.json({ erro: 'Esse cadastro não tem WhatsApp' }, { status: 400 })

  const waId = normalizarWaId(f.whatsapp)
  const primeiroNome = (f.nome ?? '').trim().split(/\s+/)[0] || 'tudo bem'
  const fim8 = waId.replace(/\D/g, '').slice(-8)

  // ------------------------------------------------------------- inbox dela
  // Três consultas simples em vez de um embed aninhado do PostgREST. Filtro
  // aninhado que falha não dá erro: devolve nada, e "nada" aqui vira "pode
  // mandar". Foi assim que a Lucilaine levou a mesma sondagem duas vezes.
  const { data: contatos } = await supabaseAdmin.from('wa_contatos').select('id').ilike('wa_id', `%${fim8}`)
  const idsContato = (contatos ?? []).map((c) => c.id as string)

  const { data: conversas } = idsContato.length
    ? await supabaseAdmin.from('wa_conversas').select('id').in('contato_id', idsContato)
    : { data: [] as Array<{ id: string }> }
  const idsConversa = (conversas ?? []).map((c) => c.id as string)

  let ultimaEntrada: string | null = null
  let jaAbordado: string | null = null
  if (idsConversa.length > 0) {
    const [entrada, abordagem] = await Promise.all([
      supabaseAdmin
        .from('wa_mensagens')
        .select('criado_em')
        .in('conversa_id', idsConversa)
        .eq('direcao', 'entrada')
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle<{ criado_em: string }>(),
      supabaseAdmin
        .from('wa_mensagens')
        .select('criado_em')
        .in('conversa_id', idsConversa)
        .eq('direcao', 'saida')
        .eq('template_nome', TEMPLATE_SONDAGEM)
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle<{ criado_em: string }>(),
    ])
    ultimaEntrada = entrada.data?.criado_em ?? null
    jaAbordado = abordagem.data?.criado_em ?? null
  }

  const agora = Date.now()
  const janelaAberta = ultimaEntrada !== null && agora - new Date(ultimaEntrada).getTime() < 24 * 60 * 60 * 1000

  // ------------------------------------------------------ 1. janela aberta
  // Melhor cenário: ela falou com a gente hoje. Texto livre, sem template, sem
  // custo de template e sem risco de recusa. O Luigi retoma a conversa que já
  // existe em vez de abrir uma do nada.
  if (janelaAberta) {
    const conversaId = idsConversa[0]
    const r = await devolverAoLuigi(conversaId, RETOMADA_ATUALIZAR)
    if (!r.ok) return NextResponse.json({ erro: r.motivo ?? 'Não consegui acionar o Luigi' }, { status: 409 })
    return NextResponse.json({
      ok: true,
      via: 'luigi',
      aviso: 'A janela está aberta — o Luigi já puxou o assunto na conversa dela. Acompanhe no inbox.',
    })
  }

  // --------------------------------------------------- 2. nunca escreveu
  // A Meta recusa marketing pra quem nunca interagiu. Não adianta tentar: a
  // recusa conta contra o número. Quem abre a janela é ela, e o convite pra
  // isso vai por e-mail.
  if (ultimaEntrada === null) {
    const ondeMandar = f.email ? `no e-mail dela (${f.email})` : 'no e-mail dela'
    return NextResponse.json(
      {
        erro:
          `${f.nome ?? 'Ela'} nunca escreveu pra gente no WhatsApp. A Meta recusa template de marketing ` +
          `nesse caso ("healthy ecosystem engagement"), então mandar só gastaria uma recusa. ` +
          `O caminho é ${ondeMandar}: peça pra ela mandar um oi no nosso número. ` +
          `Quando ela mandar, a janela abre e o Luigi conduz o resto.`,
      },
      { status: 409 },
    )
  }

  // ------------------------------------------ 3. já escreveu, janela fechada
  if (jaAbordado && agora - new Date(jaAbordado).getTime() < CARENCIA_DIAS * 24 * 60 * 60 * 1000) {
    const quando = new Date(jaAbordado).toLocaleString('pt-BR', {
      timeZone: 'America/Recife',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
    return NextResponse.json(
      { erro: `Já pedimos atualização em ${quando}. Insistir antes de ${CARENCIA_DIAS} dias vira spam.` },
      { status: 409 },
    )
  }

  const r = await enviarTemplate(waId, TEMPLATE_SONDAGEM, 'pt_BR', [
    { type: 'body', parameters: [{ type: 'text', text: primeiroNome }] },
  ])
  if (!r.ok) return NextResponse.json({ erro: `A Meta recusou: ${r.erro}` }, { status: 502 })

  await registrarSaidaInbox(waId, f.nome, r.wamid, `[template] ${TEMPLATE_SONDAGEM}`, TEMPLATE_SONDAGEM, 'mcp')

  // Sem isto o Luigi atende a dona da fábrica como se ela quisesse comprar
  // roupa — foi o que aconteceu com a Marilia em 09/09.
  await supabaseAdmin
    .from('wa_contatos')
    .update({ fornecedor_id: f.id, atualizado_em: new Date().toISOString() })
    .ilike('wa_id', `%${fim8}`)

  return NextResponse.json({
    ok: true,
    via: 'template',
    aviso: 'A janela estava fechada, então mandei a sondagem. Quando ela responder, o Luigi assume e atualiza o perfil.',
  })
}
