// app/api/admin/orcamentos/route.ts
// ============================================================================
// Gerador de orçamentos avulsos do admin.
//
// POST — cria um orçamento:
//   { cliente_nome?, cliente_documento?, itens[], frete_centavos?,
//     observacoes?, data_orcamento?, validade?, gerar_cobranca? }
//
// gerar_cobranca=true → cria cobrança ASAAS (UNDEFINED, desconto 3% até o
// vencimento) e grava QR PIX/link no registro. Exige nome + CPF/CNPJ.
// Falha na cobrança NÃO desfaz o orçamento — retorna cobranca_erro.
//
// Valores SEMPRE em centavos (integer), padrão do projeto.
// numero (ORC-<ano>-<seq>) é gerado pelo DEFAULT da coluna no Postgres
// (sequence orcamentos_numero_seq) — a app só lê o valor retornado.
//
// Protegida pelo MESMO padrão das outras rotas admin:
//   req.cookies.get(COOKIE_ADMIN)?.value + ehTokenAdminValido.
// Regra serverless: todos os await resolvidos antes de qualquer return.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { criarCobrancaOrcamento } from '@/app/lib/orcamento-cobranca'
import { metades } from '@/app/lib/orcamento-parcelas'
import { apenasDigitos } from '@/app/lib/cpf-cnpj'
import { buscarEnderecoCep } from '@/app/lib/cep'

export const dynamic = 'force-dynamic'

const TIPOS_ITEM = ['produto', 'servico'] as const
type TipoItem = (typeof TIPOS_ITEM)[number]

type ItemEntrada = {
  tipo?: unknown
  descricao?: unknown
  quantidade?: unknown
  valor_unitario_centavos?: unknown
}

type ItemValido = {
  tipo: TipoItem
  descricao: string
  quantidade: number
  valor_unitario_centavos: number
  subtotal_centavos: number
}

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/

function inteiroNaoNegativo(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0
}

/** Valida um item cru do body. Retorna o item normalizado ou uma string de erro. */
function validarItem(item: ItemEntrada, indice: number): ItemValido | string {
  const rotulo = `Item ${indice + 1}`

  if (typeof item.tipo !== 'string' || !TIPOS_ITEM.includes(item.tipo as TipoItem)) {
    return `${rotulo}: tipo deve ser 'produto' ou 'servico'.`
  }
  const descricao = typeof item.descricao === 'string' ? item.descricao.trim() : ''
  if (!descricao) {
    return `${rotulo}: descrição é obrigatória.`
  }
  const quantidade = item.quantidade
  if (typeof quantidade !== 'number' || !Number.isFinite(quantidade) || quantidade <= 0) {
    return `${rotulo}: quantidade deve ser maior que zero.`
  }
  if (!inteiroNaoNegativo(item.valor_unitario_centavos)) {
    return `${rotulo}: valor unitário inválido (centavos, inteiro ≥ 0).`
  }

  return {
    tipo: item.tipo as TipoItem,
    descricao,
    quantidade,
    valor_unitario_centavos: item.valor_unitario_centavos,
    subtotal_centavos: Math.round(quantidade * item.valor_unitario_centavos),
  }
}

// ---------------------------------------------------------------------------
// GET — lista os orcamentos avulsos ja emitidos.
//
// A tela /admin/orcamentos so criava; nao havia como ver o que voce ja tinha
// emitido. Isto e o historico pedido em 20/08/2026.
//
// Nao devolve pix_copia_cola nem pix_qr_imagem: sao campos grandes (o QR e um
// PNG em base64) e a listagem nao precisa deles.
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Nao autenticado' }, { status: 401 })
  }

  const { data, error } = await supabaseAdmin
    .from('orcamentos')
    .select(
      'id, numero, cliente_nome, cliente_documento, total_centavos, frete_centavos, ' +
        'data_orcamento, validade, status, pagamento_status, pago_em, ' +
        'asaas_payment_id, asaas_invoice_url, cobranca_vencimento, modalidade, ' +
        'desconto_pix_percentual, criado_em'
    )
    .order('criado_em', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 })
  return NextResponse.json({ orcamentos: data ?? [] })
}

export async function POST(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 })
  }

  // ---- itens -----------------------------------------------------------
  const itensCrus = body.itens
  if (!Array.isArray(itensCrus) || itensCrus.length === 0) {
    return NextResponse.json({ erro: 'Informe ao menos um item.' }, { status: 400 })
  }

  const itens: ItemValido[] = []
  for (let i = 0; i < itensCrus.length; i++) {
    const resultado = validarItem(itensCrus[i] as ItemEntrada, i)
    if (typeof resultado === 'string') {
      return NextResponse.json({ erro: resultado }, { status: 400 })
    }
    itens.push(resultado)
  }

  // ---- frete + datas + campos opcionais --------------------------------
  const frete_centavos = body.frete_centavos ?? 0
  if (!inteiroNaoNegativo(frete_centavos)) {
    return NextResponse.json({ erro: 'Frete inválido (centavos, inteiro ≥ 0).' }, { status: 400 })
  }

  const data_orcamento = body.data_orcamento
  if (data_orcamento !== undefined && (typeof data_orcamento !== 'string' || !RE_DATA.test(data_orcamento))) {
    return NextResponse.json({ erro: 'data_orcamento inválida (use YYYY-MM-DD).' }, { status: 400 })
  }
  const validade = body.validade
  if (validade !== undefined && validade !== null && validade !== '' && (typeof validade !== 'string' || !RE_DATA.test(validade))) {
    return NextResponse.json({ erro: 'validade inválida (use YYYY-MM-DD).' }, { status: 400 })
  }

  const cliente_nome =
    typeof body.cliente_nome === 'string' && body.cliente_nome.trim() ? body.cliente_nome.trim() : null
  const cliente_documento =
    typeof body.cliente_documento === 'string' && body.cliente_documento.trim() ? body.cliente_documento.trim() : null
  const observacoes =
    typeof body.observacoes === 'string' && body.observacoes.trim() ? body.observacoes.trim() : null

  // ---- email + endereço de entrega ---------------------------------------
  const cliente_email =
    typeof body.cliente_email === 'string' && body.cliente_email.trim()
      ? body.cliente_email.trim()
      : null
  if (cliente_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cliente_email)) {
    return NextResponse.json({ erro: 'Email do cliente inválido.' }, { status: 400 })
  }

  const cepDigitos =
    typeof body.cep === 'string' && body.cep.trim() ? apenasDigitos(body.cep) : ''
  if (cepDigitos && cepDigitos.length !== 8) {
    return NextResponse.json({ erro: 'CEP inválido (8 dígitos).' }, { status: 400 })
  }

  const campoTexto = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v.trim() : null

  let logradouro = campoTexto(body.logradouro)
  let bairro = campoTexto(body.bairro)
  let cidade = campoTexto(body.cidade)
  let uf = campoTexto(body.uf)
  const endereco_numero = campoTexto(body.endereco_numero)
  const endereco_complemento = campoTexto(body.endereco_complemento)

  // CEP presente e endereço incompleto → resolve server-side (ViaCEP/BrasilAPI)
  if (cepDigitos && (!logradouro || !cidade)) {
    const resolvido = await buscarEnderecoCep(cepDigitos)
    if (resolvido) {
      logradouro = logradouro ?? resolvido.logradouro
      bairro = bairro ?? resolvido.bairro
      cidade = cidade ?? resolvido.cidade
      uf = uf ?? resolvido.uf
    }
  }

  // ---- cobrança ASAAS (opcional) ----------------------------------------
  const gerar_cobranca = body.gerar_cobranca === true

  // Modalidade e desconto (21/08/2026).
  //  integral -> uma cobranca do total, com desconto se voce marcar
  //  sinal_50 -> so a PRIMEIRA metade agora; a final voce libera depois, pela
  //              tela de orcamentos, quando a producao justificar
  // O desconto e o premio de quem paga tudo de uma vez, entao no 50/50 ele
  // nao existe — nem no sinal, nem na final.
  const modalidade = body.modalidade === 'sinal_50' ? 'sinal_50' : 'integral'
  const desconto_pix_percentual =
    modalidade === 'sinal_50' ? 0 : body.desconto_pix === true ? 3 : 0

  if (gerar_cobranca) {
    if (!cliente_nome) {
      return NextResponse.json(
        { erro: 'Informe o nome do cliente pra gerar a cobrança.' },
        { status: 400 }
      )
    }
    const doc = cliente_documento ? apenasDigitos(cliente_documento) : ''
    if (doc.length !== 11 && doc.length !== 14) {
      return NextResponse.json(
        { erro: 'CPF (11 dígitos) ou CNPJ (14) válido é obrigatório pra gerar a cobrança.' },
        { status: 400 }
      )
    }
  }

  // ---- totais ------------------------------------------------------------
  const subtotal_centavos = itens.reduce((soma, item) => soma + item.subtotal_centavos, 0)
  const total_centavos = subtotal_centavos + frete_centavos

  // ---- insert (numero vem do DEFAULT da coluna) --------------------------
  const { data, error } = await supabaseAdmin
    .from('orcamentos')
    .insert({
      cliente_nome,
      cliente_documento,
      cliente_email,
      cep: cepDigitos || null,
      logradouro,
      endereco_numero,
      endereco_complemento,
      bairro,
      cidade,
      uf,
      itens,
      frete_centavos,
      subtotal_centavos,
      total_centavos,
      observacoes,
      modalidade,
      desconto_pix_percentual,
      ...(data_orcamento ? { data_orcamento } : {}),
      validade: validade && typeof validade === 'string' && validade !== '' ? validade : null,
    })
    .select()
    .single()

  if (error || !data) {
    console.error('[admin/orcamentos] erro ao inserir:', error)
    return NextResponse.json({ erro: 'Erro ao salvar orçamento.' }, { status: 500 })
  }

  // ---- cobrança ASAAS + QR PIX (não desfaz o orçamento se falhar) --------
  let orcamento = data
  let cobranca_erro: string | null = null
  if (gerar_cobranca) {
    try {
      // No 50/50 a cobranca de agora vale METADE. A outra metade nasce depois,
      // por gerarParcelaFinal(), e so com o sinal ja pago.
      const valorAgora =
        modalidade === 'sinal_50' ? metades(total_centavos).sinal : total_centavos

      const cobranca = await criarCobrancaOrcamento({
        orcamentoId: data.id,
        numero: data.numero,
        nome: cliente_nome as string,
        cpfCnpj: cliente_documento as string,
        email: cliente_email,
        valorCentavos: valorAgora,
        vencimento: typeof validade === 'string' && validade ? validade : null,
        descontoPercentual: desconto_pix_percentual,
        sufixoDescricao: modalidade === 'sinal_50' ? 'sinal 50%' : null,
      })

      // A parcela e a fonte da verdade; as colunas do orcamento seguem como
      // espelho da primeira, porque o PDF e o e-mail leem de la.
      await supabaseAdmin.from('orcamento_cobrancas').insert({
        orcamento_id: data.id,
        parcela: 1,
        rotulo: modalidade === 'sinal_50' ? 'sinal' : 'integral',
        valor_centavos: valorAgora,
        desconto_percentual: desconto_pix_percentual,
        vencimento: cobranca.vencimento,
        asaas_payment_id: cobranca.paymentId,
        asaas_invoice_url: cobranca.invoiceUrl,
        pix_copia_cola: cobranca.copiaCola,
        pix_qr_imagem: cobranca.qrImagem,
        status: 'gerada',
      })

      const { data: atualizado, error: updErr } = await supabaseAdmin
        .from('orcamentos')
        .update({
          asaas_customer_id: cobranca.customerId,
          asaas_payment_id: cobranca.paymentId,
          asaas_invoice_url: cobranca.invoiceUrl,
          pix_copia_cola: cobranca.copiaCola,
          pix_qr_imagem: cobranca.qrImagem,
          cobranca_vencimento: cobranca.vencimento,
          pagamento_status: 'gerado',
        })
        .eq('id', data.id)
        .select()
        .single()
      if (updErr || !atualizado) {
        throw new Error(updErr?.message ?? 'update do orçamento com dados da cobrança falhou')
      }
      orcamento = atualizado
    } catch (err) {
      console.error('[admin/orcamentos] cobrança ASAAS falhou:', err)
      cobranca_erro =
        'Orçamento salvo, mas a cobrança ASAAS falhou — o PDF sai sem PIX. Tente gerar de novo ou cobre manualmente.'
    }
  }

  return NextResponse.json(
    { orcamento, ...(cobranca_erro ? { cobranca_erro } : {}) },
    { status: 201 }
  )
}
