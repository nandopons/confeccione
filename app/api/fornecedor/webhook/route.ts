import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { variantesWhatsApp } from '@/app/lib/phone'
import { enviarMensagem } from '@/app/lib/zapi'
import { emailContatoFornecedor } from '@/app/lib/email'
import { criarEDispararOferta } from '@/app/lib/ofertas'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const tipoLabel: Record<string, string> = {
  interclasse: 'Interclasse/Evento',
  private_label: 'Private Label',
  peca_unica: 'Peca Unica',
  fardamento: 'Fardamento',
  padrao_esportivo: 'Padrao Esportivo',
  ajuste: 'Ajuste/Conserto',
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
    .select('id, pedido_id')
    .eq('fornecedor_id', fornecedor.id)
    .eq('status', 'enviada')
    .gt('expira_em', new Date().toISOString())
    .order('enviada_em', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!oferta) {
    return NextResponse.json({ ok: true })
  }

  if (texto.includes('sim')) {
    await supabase
      .from('ofertas')
      .update({ status: 'aceita' })
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

    // Envia dados do cliente pro fornecedor
    await enviarMensagem(
      fornecedor.whatsapp,
      `Perfeito! Aqui estão os dados do cliente:\n\nNome: ${pedido.nome}\nWhatsApp: ${pedido.whatsapp}\nE-mail: ${pedido.email}\n\nEntre em contato direto pra combinar detalhes. Boa venda!`
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
      .update({ status: 'recusada' })
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
  // Supabase pode retornar pedidos como array ou objeto dependendo do shape
  const pedido = Array.isArray(followup.pedidos) ? followup.pedidos[0] : followup.pedidos
  if (!pedido) return NextResponse.json({ ok: true })

  // Detecta opção: 1, 2 ou 3 (com tolerância pra variações)
  let opcao: '1' | '2' | '3' | null = null
  if (texto === '1' || texto.includes('deu certo') || texto.includes('fechei')) {
    opcao = '1'
  } else if (texto === '2' || texto.includes('aguardando') || texto.includes('conversando')) {
    opcao = '2'
  } else if (texto === '3' || texto.includes('não deu') || texto.includes('nao deu') || texto.includes('outro fornecedor')) {
    opcao = '3'
  }

  if (!opcao) {
    await enviarMensagem(
      pedido.whatsapp,
      'Não entendi. Responde com 1, 2 ou 3:\n\n1 - DEU CERTO\n2 - AINDA AGUARDANDO\n3 - NÃO DEU CERTO, quero outro fornecedor'
    )
    return NextResponse.json({ ok: true })
  }

  // Marca o follow-up como respondido
  await supabase
    .from('followups')
    .update({ respondido_em: new Date().toISOString(), resposta: opcao })
    .eq('id', followup.id)

  if (opcao === '1') {
    await supabase
      .from('pedidos')
      .update({ status: 'concluido' })
      .eq('id', pedido.id)

    await enviarMensagem(
      pedido.whatsapp,
      `Que ótimo, ${pedido.nome}! 🎉 Fico feliz que deu certo. Sempre que precisar de outra confecção, é só chamar a gente!`
    )
  } else if (opcao === '2') {
    await supabase
      .from('pedidos')
      .update({ status: 'em_negociacao' })
      .eq('id', pedido.id)

    await enviarMensagem(
      pedido.whatsapp,
      `Beleza, ${pedido.nome}! Vou te chamar de novo daqui a 24h pra ver como ficou. Se acontecer alguma coisa antes, é só me avisar.`
    )
  } else if (opcao === '3') {
    // Reabre pedido pro cron buscar próximo fornecedor compatível.
    // O matching já exclui fornecedores que receberam oferta antes.
    await supabase
      .from('pedidos')
      .update({ status: 'buscando_fornecedor', fornecedor_aceito_id: null })
      .eq('id', pedido.id)

    await enviarMensagem(
      pedido.whatsapp,
      `Entendi, ${pedido.nome}. Já vou buscar outro fornecedor pra você. Em pouco tempo te chamo de novo!`
    )

    try {
      await criarEDispararOferta(pedido.id)
    } catch (err) {
      console.error('reenvio após cliente recusar fornecedor falhou:', err)
    }
  }

  return NextResponse.json({ ok: true })
}
