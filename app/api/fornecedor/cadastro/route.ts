import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { normalizarWhatsApp } from '@/app/lib/phone'
import { enviarMensagem } from '@/app/lib/zapi'
import { emailBoasVindasFornecedor } from '@/app/lib/email'
import { validarCpfCnpj, apenasDigitos } from '@/app/lib/cpf-cnpj'

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
    pedido_minimo,
    estado,
    cidade,
    raio_atendimento,
    cpf_cnpj,
  } = await req.json()

  const numero = normalizarWhatsApp(whatsapp)

  // Validação do CPF/CNPJ — obrigatório a partir desta migração.
  // Fornecedores existentes pré-migração podem ter cpf_cnpj = NULL no banco
  // (via edição de cadastro sem campo novo), mas TODO novo cadastro precisa.
  const cpfCnpjLimpo = apenasDigitos(cpf_cnpj || '')
  const validacao = validarCpfCnpj(cpfCnpjLimpo)
  if (!validacao.valido) {
    return NextResponse.json(
      { error: validacao.erro ?? 'CPF/CNPJ inválido' },
      { status: 400 }
    )
  }

  // Trial Pro de 90 dias para fornecedores NOVOS.
  // Existentes mantêm o plano que já têm (não reseta com novo cadastro/edição).
  const TRIAL_DIAS = 90
  const planoExpiraEm = new Date(
    Date.now() + TRIAL_DIAS * 24 * 60 * 60 * 1000
  ).toISOString()

  const payload = {
    nome,
    whatsapp: numero,
    email,
    tipos_produto,
    descricao_livre: descricao_livre || null,
    pedido_minimo,
    estado,
    cidade: cidade || null,
    raio_atendimento,
    cpf_cnpj: cpfCnpjLimpo,
    status: 'ativo',
    etapa_bot: null,
  }

  const { data: existente } = await supabase
    .from('leads_fornecedores')
    .select('id')
    .eq('whatsapp', numero)
    .maybeSingle()

  if (existente) {
    // Edição de cadastro: NÃO mexe em plano/trial pra não resetar
    const { error } = await supabase
      .from('leads_fornecedores')
      .update(payload)
      .eq('whatsapp', numero)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    // Novo cadastro: aplica trial Pro de 90 dias
    const { error } = await supabase
      .from('leads_fornecedores')
      .insert({
        ...payload,
        plano: 'pro',
        plano_ativado_em: new Date().toISOString(),
        plano_expira_em: planoExpiraEm,
        creditos_extras: 0,
      })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await enviarMensagem(
    numero,
    `Olá ${nome}! 🎉\n\nSeu cadastro no *Confeccione* foi confirmado.\n\n🎁 *Bônus de cadastro:* você ganhou 90 dias do plano *Pro* gratuitos! Isso significa até 30 leads por mês durante esse período.\n\nEm breve você vai receber pedidos de clientes que batem com o perfil da sua produção. Quando um pedido chegar, basta responder se quer ou não atender.\n\nQualquer dúvida é só chamar aqui mesmo! 🚀`
  )

  if (email) {
    try {
      await emailBoasVindasFornecedor({ email, nome })
    } catch (err) {
      console.error('email boas-vindas falhou:', err)
    }
  }

  return NextResponse.json({ ok: true })
}
