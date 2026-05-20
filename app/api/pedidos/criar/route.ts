import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { estaEmHorarioComercial, proximoHorarioValido } from '@/app/lib/horario'
import { criarEDispararOferta } from '@/app/lib/ofertas'
import { emailConfirmacaoCliente } from '@/app/lib/email'
import { normalizarWhatsApp, validarWhatsApp } from '@/app/lib/phone'
import { enviarMensagem } from '@/app/lib/zapi'
import { tipoLabel } from '@/app/lib/ofertas-labels'
import { loginComEmailUrl } from '@/app/lib/url'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  const { tipo, quantidade, prazo, estado, nome, whatsapp, email, descricao } = await req.json()

  // ============================================================
  // Validação de campos obrigatórios
  // ============================================================
  const camposObrigatorios = { tipo, quantidade, prazo, estado, nome, whatsapp, email }
  const faltando = Object.entries(camposObrigatorios)
    .filter(([, v]) => v === undefined || v === null || v === '' || (typeof v === 'string' && v.trim() === ''))
    .map(([k]) => k)

  if (faltando.length > 0) {
    return NextResponse.json(
      { error: `Preencha todos os campos obrigatórios: ${faltando.join(', ')}` },
      { status: 400 }
    )
  }

  if (typeof quantidade !== 'number' || quantidade <= 0) {
    return NextResponse.json(
      { error: 'Quantidade deve ser um número maior que zero' },
      { status: 400 }
    )
  }

  if (!validarWhatsApp(whatsapp)) {
    return NextResponse.json(
      { error: 'WhatsApp inválido. Use o formato (DDD) 9XXXX-XXXX' },
      { status: 400 }
    )
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    return NextResponse.json(
      { error: 'E-mail inválido' },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from('pedidos')
    .insert({
      tipo,
      quantidade,
      prazo,
      estado,
      nome,
      whatsapp: normalizarWhatsApp(whatsapp),
      email,
      descricao: descricao || null,
      status: 'buscando_fornecedor',
    })
    .select('id')
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'Erro ao criar pedido' },
      { status: 500 }
    )
  }

  if (estaEmHorarioComercial()) {
    try {
      await criarEDispararOferta(data.id)
    } catch (err) {
      console.error('criarEDispararOferta error:', err)
    }
  } else {
    await supabase
      .from('pedidos')
      .update({ buscar_apos: proximoHorarioValido().toISOString() })
      .eq('id', data.id)
  }

  if (email) {
    try {
      await emailConfirmacaoCliente({
        email,
        nomeCliente: nome,
        protocolo: data.id,
        tipo,
        quantidade,
        estado,
        prazo,
      })
    } catch (err) {
      console.error('email confirmação falhou:', err)
    }
  }

  // WhatsApp de confirmação ao cliente, jogando-o pro painel.
  // Só dispara com whatsapp válido; await, mas failure-soft.
  if (validarWhatsApp(whatsapp)) {
    const tipoDesc = tipoLabel[tipo] ?? tipo
    const linhaPedido = [
      `*${tipoDesc}*`,
      typeof quantidade === 'number' ? `${quantidade} peças` : null,
      estado || null,
    ]
      .filter(Boolean)
      .join(' · ')
    const mensagemCliente =
      `✅ *Confeccione — Pedido recebido*\n\n` +
      `Olá *${nome}*!\n\n` +
      `Recebemos seu pedido:\n${linhaPedido}\n\n` +
      `Em breve enviamos para fornecedores compatíveis. Avisaremos quando alguém aceitar.\n\n` +
      `Enquanto isso, você pode acompanhar tudo pelo seu painel — inclusive subir referências, modelagens ou logomarcas:\n\n` +
      `🔗 ${loginComEmailUrl(email)}\n\n` +
      `— Confeccione`
    try {
      await enviarMensagem(normalizarWhatsApp(whatsapp), mensagemCliente)
    } catch (err) {
      console.error('whatsapp confirmação cliente falhou:', err)
    }
  }

  return NextResponse.json({ ok: true, protocolo: data.id, status: 'buscando_fornecedor' })
}
