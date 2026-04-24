import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { variantesWhatsApp } from '@/app/lib/phone'
import { enviarMensagem } from '@/app/lib/zapi'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  const body = await req.json()

  await supabase.from('webhook_debug').insert({ body })

  // Ignora mensagens enviadas por nós mesmos ou sem telefone remetente
  if (!body.phone || body.fromMe === true) {
    return NextResponse.json({ ok: true })
  }

  const variantes = variantesWhatsApp(String(body.phone))

  const { data: fornecedor } = await supabase
    .from('leads_fornecedores')
    .select('id, nome, whatsapp')
    .eq('status', 'ativo')
    .in('whatsapp', variantes)
    .maybeSingle()

  if (!fornecedor) {
    return NextResponse.json({ ok: true })
  }

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

  const texto = String(body.text?.message ?? body.body ?? '')
    .trim()
    .toLowerCase()

  if (texto.includes('sim')) {
    await supabase
      .from('ofertas')
      .update({ status: 'aceita' })
      .eq('id', oferta.id)

    const { data: pedido } = await supabase
      .from('pedidos')
      .select('nome, whatsapp, email')
      .eq('id', oferta.pedido_id)
      .single()

    if (pedido) {
      await supabase
        .from('pedidos')
        .update({ status: 'aguardando_contato', fornecedor_aceito_id: fornecedor.id })
        .eq('id', oferta.pedido_id)

      await enviarMensagem(
        fornecedor.whatsapp,
        `Perfeito! Aqui estão os dados do cliente:\n\nNome: ${pedido.nome}\nWhatsApp: ${pedido.whatsapp}\nE-mail: ${pedido.email}\n\nEntre em contato direto pra combinar detalhes. Boa venda!`
      )
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
  } else {
    await enviarMensagem(
      fornecedor.whatsapp,
      'Não entendi sua resposta, por favor responda apenas SIM ou NAO pro pedido que te mandei.'
    )
  }

  return NextResponse.json({ ok: true })
}
