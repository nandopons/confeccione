import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { variantesWhatsApp } from '@/app/lib/phone'
import { enviarMensagem } from '@/app/lib/zapi'
import { emailContatoFornecedor } from '@/app/lib/email'
import { criarEDispararOferta } from '@/app/lib/ofertas'
import {
  PLANOS_CONFIG,
  contarOfertasMesAtual,
  planoEfetivo,
} from '@/app/lib/planos'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const tipoLabel: Record<string, string> = {
  interclasse: 'Interclasse/Evento',
  private_label: 'Private Label',
  fitness: 'Fitness',
  moda_praia: 'Moda Praia',
  moda_intima: 'Moda Íntima',
  padrao_esportivo: 'Padrão Esportivo',
  fardamento: 'Fardamento',
  inverno: 'Inverno',
  roupas_uv: 'Roupas UV',
  bones: 'Bonés',
  bolsas: 'Bolsas e Acessórios',
}

export async function POST(req: Request) {
  const body = await req.json()

  await supabase.from('webhook_debug').insert({ body })

  // Ignora mensagens enviadas por nós mesmos ou sem telefone remetente
  if (!body.phone || body.fromMe === true) {
    return NextResponse.json({ ok: true })
  }

  const variantes = variantesWhatsApp(String(body.phone))
  const texto = String(body.text?.message ?? body.body ?? '')
    .trim()
    .toLowerCase()

  // ============================================================
  // ROTA 1: telefone bate com FORNECEDOR ativo → resposta de oferta
  // ============================================================
  const { data: fornecedor } = await supabase
    .from('leads_fornecedores')
    .select('id, nome, whatsapp, cidade, estado')
    .eq('status', 'ativo')
    .in('whatsapp', variantes)
    .maybeSingle()

  if (fornecedor) {
    return await tratarRespostaFornecedor(fornecedor, texto)
  }

  // ============================================================
  // ROTA 2: telefone bate com CLIENTE de pedido em follow-up
  // ============================================================
  // Busca follow-up enviado e ainda sem resposta cujo whatsapp do
  // pedido bate com o telefone que escreveu.
  const { data: followup } = await supabase
    .from('followups')
    .select('id, pedido_id, tipo, pedidos!inner(id, nome, whatsapp, status)')
    .is('respondido_em', null)
    .in('pedidos.whatsapp', variantes)
    .order('enviado_em', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (followup) {
    return await tratarRespostaCliente(followup, texto)
  }

  return NextResponse.json({ ok: true })
}

// ============================================================
// Tratamento de resposta do FORNECEDOR (SIM / NAO / outro)
// ============================================================
async function tratarRespostaFornecedor(
  fornecedor: {
    id: string
    nome: string
    whatsapp: string
    cidade: string | null
    estado: string
  },
  texto: string
): Promise<NextResponse> {
  // Busca oferta enviada ainda não expirada (mais recente)
  const { data: oferta } = await supabase
    .from('ofertas')
    .select('id, pedido_id, tipo_oferta')
    .eq('fornecedor_id', fornecedor.id)
    .eq('status', 'enviada')
    .gt('expira_em', new Date().toISOString())
    .order('enviada_em', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!oferta) {
    return NextResponse.json({ ok: true })
  }

  // ============================================================
  // ROTA: oferta SEM CRÉDITO (gatilho de upgrade — opções 1-5)
  // ============================================================
  if (oferta.tipo_oferta === 'sem_credito') {
    return await tratarRespostaSemCredito(fornecedor, oferta, texto)
  }

  // ============================================================
  // ROTA: oferta NORMAL (SIM / NAO)
  // ============================================================
  if (texto.includes('sim')) {
    await supabase
      .from('ofertas')
      .update({ status: 'aceita', respondida_em: new Date().toISOString() })
      .eq('id', oferta.id)

    const { data: pedido } = await supabase
      .from('pedidos')
      .select('nome, whatsapp, email, tipo')
      .eq('id', oferta.pedido_id)
      .single()

    if (!pedido) return NextResponse.json({ ok: true })

    await supabase
      .from('pedidos')
      .update({ status: 'aguardando_contato', fornecedor_aceito_id: fornecedor.id })
      .eq('id', oferta.pedido_id)

    // Envia dados do cliente pro fornecedor + resumo de leads do mês
    const resumoCota = await montarResumoCotaMes(fornecedor.id)
    await enviarMensagem(
      fornecedor.whatsapp,
      `Perfeito! Aqui estão os dados do cliente:\n\nNome: ${pedido.nome}\nWhatsApp: ${pedido.whatsapp}\nE-mail: ${pedido.email}\n\nEntre em contato direto pra combinar detalhes. Boa venda!\n\n${resumoCota}`
    )

    // ============================================================
    // 3a — Aviso imediato ao cliente (WhatsApp + Email)
    // ============================================================
    const tipo = tipoLabel[pedido.tipo] ?? pedido.tipo
    const localFornec = fornecedor.cidade
      ? `${fornecedor.cidade}/${fornecedor.estado}`
      : fornecedor.estado

    const mensagemCliente =
      `Boa notícia, ${pedido.nome}! 🎉\n\n` +
      `Encontramos um fornecedor pro seu pedido de ${tipo}:\n\n` +
      `*${fornecedor.nome}*\n` +
      `📱 ${fornecedor.whatsapp}\n` +
      `📍 ${localFornec}\n\n` +
      `Ele vai te chamar nas próximas horas. Se preferir, você pode entrar em contato direto.\n\n` +
      `Daqui a 24h te chamo aqui pra saber se deu certo!`

    try {
      await enviarMensagem(pedido.whatsapp, mensagemCliente)
    } catch (err) {
      console.error('aviso cliente whatsapp falhou:', err)
    }

    if (pedido.email) {
      try {
        await emailContatoFornecedor({
          email: pedido.email,
          nomeCliente: pedido.nome,
          tipo,
          nomeFornecedor: fornecedor.nome,
          whatsappFornecedor: fornecedor.whatsapp,
          cidadeFornecedor: fornecedor.cidade,
          estadoFornecedor: fornecedor.estado,
        })
      } catch (err) {
        console.error('aviso cliente email falhou:', err)
      }
    }
  } else if (texto.includes('não') || texto.includes('nao')) {
    await supabase
      .from('ofertas')
      .update({ status: 'recusada', respondida_em: new Date().toISOString() })
      .eq('id', oferta.id)

    await enviarMensagem(
      fornecedor.whatsapp,
      'Ok, sem problema! Vamos oferecer pra outro fornecedor.'
    )

    // Já dispara pra próximo fornecedor de imediato
    try {
      await criarEDispararOferta(oferta.pedido_id)
    } catch (err) {
      console.error('reenvio após recusa falhou:', err)
    }
  } else {
    await enviarMensagem(
      fornecedor.whatsapp,
      'Não entendi sua resposta, por favor responda apenas SIM ou NAO pro pedido que te mandei.'
    )
  }

  return NextResponse.json({ ok: true })
}

// ============================================================
// Tratamento de resposta do FORNECEDOR a oferta SEM CRÉDITO
// (1/2/3 = pacotes, 4 = upgrade, 5 = não tenho interesse)
// ============================================================
async function tratarRespostaSemCredito(
  fornecedor: { id: string; nome: string; whatsapp: string },
  oferta: { id: string; pedido_id: string },
  texto: string
): Promise<NextResponse> {
  const opcao = texto.trim()

  // Opção 5: não tenho interesse → recusa final
  if (opcao === '5' || texto.includes('não tenho') || texto.includes('nao tenho')) {
    await supabase
      .from('ofertas')
      .update({ status: 'recusada_sem_credito', respondida_em: new Date().toISOString() })
      .eq('id', oferta.id)

    await enviarMensagem(
      fornecedor.whatsapp,
      'Ok, sem problema! Vou oferecer pra outro fornecedor.'
    )

    try {
      await criarEDispararOferta(oferta.pedido_id)
    } catch (err) {
      console.error('reenvio após recusa sem crédito falhou:', err)
    }

    return NextResponse.json({ ok: true })
  }

  // Opções 1-4: interesse em comprar pacote ou upgrade
  // Por enquanto: NÃO processa pagamento (Stripe vem depois).
  // Sistema marca a intenção e notifica o admin pra processar manual.
  if (['1', '2', '3', '4'].includes(opcao)) {
    await enviarMensagem(
      fornecedor.whatsapp,
      `Perfeito, ${fornecedor.nome}! 🎯\n\nRecebi sua escolha (opção ${opcao}). Em poucos minutos um membro da nossa equipe vai te chamar pra finalizar o pagamento e liberar este lead pra você.\n\n⏰ Lembrete: este lead fica reservado pra você por 3 horas. Se passar desse prazo sem fechamento, vou ofertar pra outro fornecedor.`
    )

    // Notifica admin pra processar manualmente
    const { ADMIN_WHATSAPP } = process.env
    if (ADMIN_WHATSAPP) {
      try {
        await enviarMensagem(
          ADMIN_WHATSAPP,
          `🔔 Fornecedor *${fornecedor.nome}* (${fornecedor.whatsapp}) escolheu opção *${opcao}* na oferta sem crédito.\n\nPedido: ${oferta.pedido_id}\nOferta: ${oferta.id}\n\nProcesse o pagamento e libere o lead.`
        )
      } catch (err) {
        console.error('aviso admin sem crédito falhou:', err)
      }
    }

    return NextResponse.json({ ok: true })
  }

  // Resposta inválida
  await enviarMensagem(
    fornecedor.whatsapp,
    'Não entendi sua resposta. Responde com o número da opção (1, 2, 3, 4 ou 5).'
  )

  return NextResponse.json({ ok: true })
}

// ============================================================
// Helper: monta resumo da cota mensal pra incluir após aceite
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

// ============================================================
// Tratamento de resposta do CLIENTE ao follow-up (1 / 2 / 3)
// ============================================================
type PedidoFollowup = { id: string; nome: string; whatsapp: string; status: string }

async function tratarRespostaCliente(
  followup: {
    id: string
    pedido_id: string
    tipo: string
    pedidos: PedidoFollowup | PedidoFollowup[]
  },
  texto: string
): Promise<NextResponse> {
  // Supabase com !inner pode retornar array ou objeto dependendo da versão
  const pedido = Array.isArray(followup.pedidos)
    ? followup.pedidos[0]
    : followup.pedidos

  if (!pedido) return NextResponse.json({ ok: true })

  const opcao = texto.trim()

  if (opcao === '1') {
    // DEU CERTO
    await supabase
      .from('followups')
      .update({ respondido_em: new Date().toISOString(), resposta: '1' })
      .eq('id', followup.id)

    await supabase
      .from('pedidos')
      .update({ status: 'concluido' })
      .eq('id', pedido.id)

    await enviarMensagem(
      pedido.whatsapp,
      `Que ótimo, ${pedido.nome}! 🎉 Fico feliz que deu certo. Qualquer pedido novo no futuro, é só voltar aqui!`
    )
  } else if (opcao === '2') {
    // AINDA AGUARDANDO
    await supabase
      .from('followups')
      .update({ respondido_em: new Date().toISOString(), resposta: '2' })
      .eq('id', followup.id)

    await supabase
      .from('pedidos')
      .update({ status: 'em_negociacao' })
      .eq('id', pedido.id)

    await enviarMensagem(
      pedido.whatsapp,
      `Beleza, ${pedido.nome}! Vou esperar mais um pouco e te chamo de novo daqui a 24h pra ver se rolou.`
    )
  } else if (opcao === '3') {
    // NÃO DEU CERTO — quer outro fornecedor
    await supabase
      .from('followups')
      .update({ respondido_em: new Date().toISOString(), resposta: '3' })
      .eq('id', followup.id)

    await supabase
      .from('pedidos')
      .update({ status: 'buscando_fornecedor', fornecedor_aceito_id: null })
      .eq('id', pedido.id)

    await enviarMensagem(
      pedido.whatsapp,
      `Sem problema, ${pedido.nome}! Vou buscar outro fornecedor pra você. Em breve te aviso aqui!`
    )

    // Dispara busca de novo fornecedor
    try {
      await criarEDispararOferta(pedido.id)
    } catch (err) {
      console.error('rebusca após recusa cliente falhou:', err)
    }
  } else {
    await enviarMensagem(
      pedido.whatsapp,
      'Não entendi! Responde com 1 (deu certo), 2 (ainda aguardando) ou 3 (quero outro fornecedor).'
    )
  }

  return NextResponse.json({ ok: true })
}
