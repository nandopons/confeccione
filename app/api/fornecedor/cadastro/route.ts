import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { normalizarWhatsApp } from '@/app/lib/phone'
import { enviarMensagem } from '@/app/lib/zapi'
import { emailBoasVindasFornecedor } from '@/app/lib/email'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  const {
    nome,
    whatsapp,
    email,
    tipos_produto,
    descricao_livre,
    capacidade_min,
    capacidade_max,
    emite_nf,
    estado,
    cidade,
    raio_atendimento,
  } = await req.json()

  const numero = normalizarWhatsApp(whatsapp)

  const payload = {
    nome,
    whatsapp: numero,
    email,
    tipos_produto,
    descricao_livre: descricao_livre || null,
    capacidade_min,
    capacidade_max: capacidade_max ?? null,
    emite_nf,
    estado,
    cidade: cidade || null,
    raio_atendimento,
    status: 'ativo',
    etapa_bot: null,
  }

  const { data: existente } = await supabase
    .from('leads_fornecedores')
    .select('id')
    .eq('whatsapp', numero)
    .maybeSingle()

  if (existente) {
    const { error } = await supabase
      .from('leads_fornecedores')
      .update(payload)
      .eq('whatsapp', numero)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await supabase
      .from('leads_fornecedores')
      .insert(payload)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await enviarMensagem(
    numero,
    `Olá ${nome}! 🎉\n\nSeu cadastro no *Confeccione* foi confirmado.\n\nEm breve você vai receber pedidos de clientes que batem com o perfil da sua produção. Quando um pedido chegar, basta responder se quer ou não atender.\n\nQualquer dúvida é só chamar aqui mesmo! 🚀`
  )

  if (email) {
    emailBoasVindasFornecedor({ email, nome }).catch(err =>
      console.error('email boas-vindas falhou:', err)
    )
  }

  return NextResponse.json({ ok: true })
}
