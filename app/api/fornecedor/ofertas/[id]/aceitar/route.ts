// app/api/fornecedor/ofertas/[id]/aceitar/route.ts
// ============================================================================
// API: aceitar uma oferta pelo painel do fornecedor (alternativa ao SIM via WA).
//
// FLUXO (replica a lógica do webhook quando o fornecedor responde SIM):
//   1. Valida sessão do fornecedor logado
//   2. Valida que a oferta existe, pertence ao fornecedor logado, e está pendente
//   3. UPDATE oferta: status = 'aceita'
//   4. UPDATE pedido: status = 'aguardando_contato', fornecedor_aceito_id
//   5. Notifica fornecedor (WhatsApp) com dados do cliente + cota
//   6. Notifica cliente (WhatsApp + email opcional) com dados do fornecedor
//
// SEGURANÇA:
//   - Só aceita ofertas com status='enviada' E expira_em > now
//   - Garante que fornecedor_id da oferta == fornecedor logado (sem hijacking)
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getFornecedorAtual } from '@/app/lib/auth-server'
import { enviarMensagem } from '@/app/lib/zapi'
import { emailContatoFornecedor } from '@/app/lib/email'
import { tipoLabel } from '@/app/lib/ofertas'
import { contarOfertasMesAtual, planoEfetivo, PLANOS_CONFIG } from '@/app/lib/planos'
import { linkWhatsApp } from '@/app/lib/phone'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // 1. Autenticação
  const fornecedor = await getFornecedorAtual()
  if (!fornecedor) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  if (fornecedor.status === 'inativo') {
    return NextResponse.json(
      { erro: 'Conta inativa. Entre em contato com o suporte.' },
      { status: 403 }
    )
  }

  const { id: ofertaId } = await params

  // 2. Valida oferta
  const { data: oferta, error: ofertaErr } = await supabase
    .from('ofertas')
    .select('id, fornecedor_id, pedido_id, status, expira_em, tipo_oferta')
    .eq('id', ofertaId)
    .single()

  if (ofertaErr || !oferta) {
    return NextResponse.json({ erro: 'Oferta não encontrada' }, { status: 404 })
  }

  if (oferta.fornecedor_id !== fornecedor.id) {
    return NextResponse.json({ erro: 'Sem permissão' }, { status: 403 })
  }

  if (oferta.status !== 'enviada') {
    return NextResponse.json(
      { erro: 'Esta oferta já foi processada' },
      { status: 409 }
    )
  }

  if (new Date(oferta.expira_em).getTime() <= Date.now()) {
    return NextResponse.json(
      { erro: 'Esta oferta já expirou' },
      { status: 409 }
    )
  }

  if (oferta.tipo_oferta !== 'normal') {
    return NextResponse.json(
      { erro: 'Tipo de oferta não suportado pelo painel' },
      { status: 400 }
    )
  }

  // 3. Busca dados completos do fornecedor (precisa de cidade/estado pra notificação)
  const { data: fornecedorCompleto } = await supabase
    .from('leads_fornecedores')
    .select('id, nome, whatsapp, cidade, estado, plano, plano_expira_em, creditos_extras')
    .eq('id', fornecedor.id)
    .single()

  if (!fornecedorCompleto) {
    return NextResponse.json({ erro: 'Fornecedor não encontrado' }, { status: 500 })
  }

  // 4. Busca pedido
  const { data: pedido } = await supabase
    .from('pedidos')
    .select('id, nome, whatsapp, email, tipo, status')
    .eq('id', oferta.pedido_id)
    .single()

  if (!pedido) {
    return NextResponse.json({ erro: 'Pedido não encontrado' }, { status: 404 })
  }

  // Pedido pode ter sido aceito por outro fornecedor enquanto este olhava
  if (pedido.status !== 'buscando_fornecedor') {
    return NextResponse.json(
      { erro: 'Este pedido já foi atendido por outro fornecedor' },
      { status: 409 }
    )
  }

  // 5. UPDATE oferta → aceita
  const { error: updateOfertaErr } = await supabase
    .from('ofertas')
    .update({ status: 'aceita', respondida_em: new Date().toISOString() })
    .eq('id', oferta.id)

  if (updateOfertaErr) {
    console.error('aceitar: erro ao atualizar oferta', updateOfertaErr)
    return NextResponse.json({ erro: 'Erro ao processar' }, { status: 500 })
  }

  // 6. UPDATE pedido → aguardando_contato
  const { error: updatePedidoErr } = await supabase
    .from('pedidos')
    .update({
      status: 'aguardando_contato',
      fornecedor_aceito_id: fornecedor.id,
    })
    .eq('id', pedido.id)

  if (updatePedidoErr) {
    console.error('aceitar: erro ao atualizar pedido', updatePedidoErr)
    // Tenta rollback da oferta
    await supabase
      .from('ofertas')
      .update({ status: 'enviada' })
      .eq('id', oferta.id)
    return NextResponse.json({ erro: 'Erro ao processar' }, { status: 500 })
  }

  // Cleanup órfão: se este pedido estava registrado como órfão ativo,
  // marca como resolvido. Failure-soft: aceite é porta de monetização,
  // NUNCA pode falhar só porque cleanup de órfão falhou.
  try {
    const { error: orfErr } = await supabase
      .from('pedidos_orfaos')
      .update({ status_orfao: 'resolvido' })
      .eq('pedido_id', pedido.id)
      .in('status_orfao', ['aberto', 'em_captacao'])

    if (orfErr) {
      console.error('aceitar: cleanup órfão falhou (não-bloqueante):', orfErr)
    }
  } catch (err) {
    console.error('aceitar: cleanup órfão exception (não-bloqueante):', err)
  }

  // 7. Notifica fornecedor (WhatsApp) — best effort
  const tipo = tipoLabel[pedido.tipo] ?? pedido.tipo

  try {
    const resumoCota = await montarResumoCotaMes(fornecedor.id)
    await enviarMensagem(
      fornecedorCompleto.whatsapp,
      `Perfeito! Aqui estão os dados do cliente:\n\nNome: ${pedido.nome}\nWhatsApp: ${pedido.whatsapp}\nE-mail: ${pedido.email}\n\n👉 Falar com o cliente: ${linkWhatsApp(pedido.whatsapp)}\n\nEntre em contato direto pra combinar detalhes. Boa venda!\n\n${resumoCota}`
    )
  } catch (err) {
    console.error('aceitar: aviso fornecedor whatsapp falhou:', err)
  }

  // 8. Notifica cliente (WhatsApp) — best effort
  const localFornec = fornecedorCompleto.cidade
    ? `${fornecedorCompleto.cidade}/${fornecedorCompleto.estado}`
    : fornecedorCompleto.estado

  const mensagemCliente =
    `Boa notícia, ${pedido.nome}! 🎉\n\n` +
    `Encontramos um fornecedor pro seu pedido de ${tipo}:\n\n` +
    `*${fornecedorCompleto.nome}*\n` +
    `📱 ${fornecedorCompleto.whatsapp}\n` +
    `📍 ${localFornec}\n\n` +
    `👉 Falar com o fornecedor: ${linkWhatsApp(fornecedorCompleto.whatsapp)}\n\n` +
    `Ele vai te chamar nas próximas horas. Se preferir, você pode entrar em contato direto.\n\n` +
    `Daqui a 24h te chamo aqui pra saber se deu certo!`

  try {
    await enviarMensagem(pedido.whatsapp, mensagemCliente)
  } catch (err) {
    console.error('aceitar: aviso cliente whatsapp falhou:', err)
  }

  // 9. Notifica cliente (email) — best effort
  if (pedido.email) {
    try {
      await emailContatoFornecedor({
        email: pedido.email,
        nomeCliente: pedido.nome,
        tipo,
        nomeFornecedor: fornecedorCompleto.nome,
        whatsappFornecedor: fornecedorCompleto.whatsapp,
        cidadeFornecedor: fornecedorCompleto.cidade,
        estadoFornecedor: fornecedorCompleto.estado,
      })
    } catch (err) {
      console.error('aceitar: aviso cliente email falhou:', err)
    }
  }

  return NextResponse.json({
    ok: true,
    cliente: {
      nome: pedido.nome,
      whatsapp: pedido.whatsapp,
      email: pedido.email,
    },
  })
}

// ============================================================
// Helper: monta resumo da cota mensal pra incluir após aceite
// (replicado de app/api/fornecedor/webhook/route.ts pra evitar acoplamento)
// ============================================================
async function montarResumoCotaMes(fornecedorId: string): Promise<string> {
  const { data: f } = await supabase
    .from('leads_fornecedores')
    .select('plano, plano_expira_em, creditos_extras')
    .eq('id', fornecedorId)
    .single()

  if (!f) return ''

  const planoAtual = planoEfetivo({
    plano: f.plano,
    plano_expira_em: f.plano_expira_em,
  })
  const config = PLANOS_CONFIG[planoAtual]
  const usados = await contarOfertasMesAtual(fornecedorId)

  let resumo = `📊 Você usou ${usados} de ${config.leads_inclusos} leads do plano *${config.nome}* este mês.`

  if (f.creditos_extras > 0) {
    resumo += `\n💎 Créditos extras disponíveis: ${f.creditos_extras}`
  }

  return resumo
}
