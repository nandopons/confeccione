import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { criarEDispararOferta } from '@/app/lib/ofertas'
import { emailConfirmacaoCliente } from '@/app/lib/email'
import { normalizarWhatsApp, validarWhatsApp } from '@/app/lib/phone'
import { getContaAtual, perfilCompleto } from '@/app/lib/cliente-auth'
import { enviarMensagem } from '@/app/lib/zapi'
import { tipoLabel } from '@/app/lib/ofertas-labels'
import { loginComEmailUrl } from '@/app/lib/url'
import { primeiroNome } from '@/app/lib/nome'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  const body = await req.json()

  // Cliente autenticado (sessão): dados pessoais vêm da conta, não do body.
  // Anônimo (home): conta = null → comportamento original intacto.
  const conta = await getContaAtual()

  const tipo = body.tipo
  const quantidade = body.quantidade
  const prazo = body.prazo
  const estado = body.estado
  const descricao = body.descricao
  const nome = conta ? (conta.nome ?? conta.email.split('@')[0]) : body.nome
  const email = conta ? conta.email : body.email
  const whatsapp = conta ? conta.whatsapp : body.whatsapp
  const contaId: string | null = conta?.id ?? null

  // Cliente autenticado precisa de perfil completo (WhatsApp) pra criar pedido.
  // A página /cliente/pedido/novo já bloqueia antes, isto é defesa em profundidade.
  if (conta && !perfilCompleto(conta)) {
    return NextResponse.json(
      { error: 'Complete seu perfil (WhatsApp) antes de criar um pedido.' },
      { status: 400 },
    )
  }

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
      conta_id: contaId,
    })
    .select('id')
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'Erro ao criar pedido' },
      { status: 500 }
    )
  }

  // Dispara a 1ª oferta. O gate de horário comercial vive dentro de
  // criarEDispararOferta: fora de hora, ela agenda buscar_apos e a TAREFA 2
  // do scheduler acorda o pedido no próximo ciclo válido.
  try {
    await criarEDispararOferta(data.id)
  } catch (err) {
    console.error('criarEDispararOferta error:', err)
  }

  if (email) {
    try {
      await emailConfirmacaoCliente({
        email,
        nomeCliente: primeiroNome(nome),
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
      `Olá *${primeiroNome(nome)}*!\n\n` +
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
