// app/api/fornecedor/asaas/checkout/route.ts
// ============================================================================
// Endpoint de checkout próprio. Recebe escolha de pacote/assinatura + método
// de pagamento, cria customer no Asaas se necessário, cria cobrança/assinatura
// e devolve link/QR pro fornecedor pagar.
//
// Body JSON:
//   { tipo: 'pacote_leads_5'|'pacote_leads_10'|'pacote_leads_25'
//          |'assinatura_starter'|'assinatura_pro',
//     metodo: 'pix'|'boleto'|'cartao',
//     cpf_cnpj?: string }  -- só se fornecedor ainda não tem
//
// Failure-soft: erros do Asaas viram 500 com mensagem genérica pro user;
// detalhes vão pro log estruturado.
//
// Idempotência soft: se há pagamento PENDENTE do mesmo tipo nas últimas 2h,
// reusa link existente em vez de criar nova cobrança.
// ============================================================================

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getFornecedorAtual } from '@/app/lib/auth-server'
import { apenasDigitos, validarCpfCnpj } from '@/app/lib/cpf-cnpj'
import { criarOuObterCustomer } from '@/app/lib/asaas-customers'
import {
  criarCobrancaPacote,
  PRECO_PACOTES_CENTAVOS,
} from '@/app/lib/asaas-payments'
import { criarAssinatura } from '@/app/lib/asaas-subscriptions'
import { PLANOS_CONFIG, planoEfetivo, type Plano } from '@/app/lib/planos'
import { AsaasApiError, type MetodoPagamento } from '@/app/lib/asaas'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type TipoPacote = 'pacote_leads_5' | 'pacote_leads_10' | 'pacote_leads_25'
type TipoAssinatura = 'assinatura_starter' | 'assinatura_pro'
type TipoCheckout = TipoPacote | TipoAssinatura

const TIPOS_PACOTE: TipoPacote[] = [
  'pacote_leads_5',
  'pacote_leads_10',
  'pacote_leads_25',
]
const TIPOS_ASSINATURA: TipoAssinatura[] = [
  'assinatura_starter',
  'assinatura_pro',
]
const METODOS_VALIDOS: MetodoPagamento[] = ['pix', 'boleto', 'cartao']

const JANELA_IDEMPOTENCIA_MS = 2 * 60 * 60 * 1000 // 2 horas

type Body = {
  tipo: TipoCheckout
  metodo: MetodoPagamento
  cpf_cnpj?: string
}

export async function POST(req: Request) {
  // 1. Autenticação
  const sessao = await getFornecedorAtual()
  if (!sessao) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  // 2. Parse e validação do body
  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (
    !TIPOS_PACOTE.includes(body.tipo as TipoPacote) &&
    !TIPOS_ASSINATURA.includes(body.tipo as TipoAssinatura)
  ) {
    return NextResponse.json({ error: 'tipo_invalido' }, { status: 422 })
  }
  if (!METODOS_VALIDOS.includes(body.metodo)) {
    return NextResponse.json({ error: 'metodo_invalido' }, { status: 422 })
  }

  // 3. Carrega fornecedor
  const { data: forn, error: fornErr } = await supabase
    .from('leads_fornecedores')
    .select(
      'id, nome, whatsapp, email, cpf_cnpj, plano, plano_expira_em, plano_ativado_em, asaas_customer_id'
    )
    .eq('id', sessao.id)
    .single()

  if (fornErr || !forn) {
    console.error('[checkout] fornecedor não encontrado', sessao.id, fornErr)
    return NextResponse.json({ error: 'fornecedor_nao_encontrado' }, { status: 500 })
  }

  // 4. CPF/CNPJ — exige + valida + persiste se foi fornecido no body
  let cpfCnpjFinal = forn.cpf_cnpj as string | null
  if (!cpfCnpjFinal && !body.cpf_cnpj) {
    return NextResponse.json({ error: 'cpf_cnpj_required' }, { status: 422 })
  }
  if (body.cpf_cnpj) {
    const validacao = validarCpfCnpj(body.cpf_cnpj)
    if (!validacao.valido) {
      return NextResponse.json(
        { error: 'cpf_cnpj_invalido', detalhe: validacao.erro },
        { status: 422 }
      )
    }
    cpfCnpjFinal = apenasDigitos(body.cpf_cnpj)
    const { error: updErr } = await supabase
      .from('leads_fornecedores')
      .update({ cpf_cnpj: cpfCnpjFinal })
      .eq('id', forn.id)
    if (updErr) {
      console.error('[checkout] update cpf_cnpj falhou', forn.id, updErr)
      return NextResponse.json({ error: 'erro_persistir_cpf_cnpj' }, { status: 500 })
    }
  }

  // 5. Validação adicional pra assinatura: bloqueia se já tem assinatura paga ATIVA
  //    no Asaas (paga nos últimos 35 dias, considerando ciclo mensal + folga).
  //
  //    Convenção: plano_expira_em SEMPRE preenchido. Trial PRO em curso continua
  //    permitindo upgrade (fornecedor pode comprar antes do trial expirar — é
  //    upsell, não bloqueio). O que bloqueia é ter assinatura paga recente em
  //    pagamentos_asaas — ela é a fonte de verdade de "está pagando".
  const planoEfetivoAtual = planoEfetivo({
    plano: forn.plano as Plano,
    plano_expira_em: forn.plano_expira_em,
  })
  const ehAssinatura = TIPOS_ASSINATURA.includes(body.tipo as TipoAssinatura)
  if (ehAssinatura) {
    const limiteAssinaturaAtiva = new Date(
      Date.now() - 35 * 24 * 60 * 60 * 1000
    ).toISOString()
    const { data: assinaturaAtiva } = await supabase
      .from('pagamentos_asaas')
      .select('asaas_subscription_id, tipo, criado_em')
      .eq('fornecedor_id', forn.id)
      .in('tipo', ['assinatura_starter', 'assinatura_pro'])
      .eq('status', 'pago')
      .gte('criado_em', limiteAssinaturaAtiva)
      .order('criado_em', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (assinaturaAtiva) {
      return NextResponse.json(
        {
          error: 'ja_possui_assinatura_ativa',
          tipoAtual: assinaturaAtiva.tipo,
          asaasSubscriptionId: assinaturaAtiva.asaas_subscription_id,
        },
        { status: 422 }
      )
    }
  }

  // 6. Idempotência soft — última cobrança PENDENTE do mesmo tipo nas últimas 2h
  const limiteJanela = new Date(Date.now() - JANELA_IDEMPOTENCIA_MS).toISOString()
  const { data: existente } = await supabase
    .from('pagamentos_asaas')
    .select(
      'asaas_payment_id, link_pagamento, qr_code_pix, qr_code_pix_imagem, vencimento'
    )
    .eq('fornecedor_id', forn.id)
    .eq('tipo', body.tipo)
    .eq('status', 'pendente')
    .gte('criado_em', limiteJanela)
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existente) {
    return NextResponse.json({
      asaas_payment_id: existente.asaas_payment_id,
      link_pagamento: existente.link_pagamento,
      qr_code_pix: existente.qr_code_pix,
      qr_code_pix_imagem: existente.qr_code_pix_imagem,
      vencimento: existente.vencimento,
      reused: true,
    })
  }

  // 7. Garante customer no Asaas
  let customer: { id: string }
  try {
    customer = await criarOuObterCustomer({
      fornecedorId: forn.id,
      nome: forn.nome,
      email: forn.email,
      whatsapp: forn.whatsapp,
      cpfCnpj: cpfCnpjFinal!,
    })
  } catch (err) {
    logErroAsaas('garanteCustomer', forn.id, err)
    return NextResponse.json({ error: 'erro_asaas' }, { status: 500 })
  }

  // 8. Cria cobrança ou assinatura
  try {
    if (TIPOS_PACOTE.includes(body.tipo as TipoPacote)) {
      const tipoPacote = body.tipo as TipoPacote
      const valorCentavos = PRECO_PACOTES_CENTAVOS[tipoPacote][planoEfetivoAtual]
      const resultado = await criarCobrancaPacote({
        fornecedorId: forn.id,
        asaasCustomerId: customer.id,
        tipo: tipoPacote,
        valorCentavos,
        metodo: body.metodo,
      })
      return NextResponse.json({
        asaas_payment_id: resultado.paymentId,
        link_pagamento: resultado.linkPagamento,
        qr_code_pix: resultado.qrCodePix,
        qr_code_pix_imagem: resultado.qrCodePixImagem,
        vencimento: resultado.vencimento,
      })
    } else {
      const tipoAssinatura = body.tipo as TipoAssinatura
      const plano = (
        tipoAssinatura === 'assinatura_starter' ? 'starter' : 'pro'
      ) as Exclude<Plano, 'free'>
      // Validação adicional: PLANOS_CONFIG[plano] precisa existir
      if (!PLANOS_CONFIG[plano]) {
        return NextResponse.json({ error: 'plano_invalido' }, { status: 422 })
      }
      const resultado = await criarAssinatura({
        fornecedorId: forn.id,
        asaasCustomerId: customer.id,
        plano,
        metodo: body.metodo,
      })
      return NextResponse.json({
        asaas_payment_id: resultado.primeiraFatura.paymentId,
        asaas_subscription_id: resultado.subscriptionId,
        link_pagamento: resultado.primeiraFatura.linkPagamento,
        qr_code_pix: resultado.primeiraFatura.qrCodePix,
        qr_code_pix_imagem: resultado.primeiraFatura.qrCodePixImagem,
        vencimento: resultado.primeiraFatura.vencimento,
      })
    }
  } catch (err) {
    logErroAsaas('criarCobranca/Assinatura', forn.id, err)
    return NextResponse.json({ error: 'erro_asaas' }, { status: 500 })
  }
}

// ============================================================
// Log estruturado de erro Asaas
// ============================================================
function logErroAsaas(endpoint: string, fornecedorId: string, err: unknown) {
  if (err instanceof AsaasApiError) {
    console.error('[checkout] erro Asaas', {
      endpoint,
      fornecedorId,
      status: err.status,
      errors: err.errors,
    })
    return
  }
  console.error('[checkout] erro inesperado', {
    endpoint,
    fornecedorId,
    err: err instanceof Error ? err.message : String(err),
  })
}
