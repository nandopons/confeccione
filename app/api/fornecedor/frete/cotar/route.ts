// POST /api/fornecedor/frete/cotar — cotação Melhor Envio pro orçamento.
// Body: { ofertaId, volumes: [{ altura, largura, comprimento, peso }], seguroCentavos, cepOrigem? }
//
// Origem = o CEP que ela informou no modal; sem ele, o do cadastro. O informado
// grava no cadastro, do mesmo jeito que a conversa faz — `leads_fornecedores.cep`
// estava vazio em 47 dos 47 aprovados em 24/09/2026, porque nada o coletava.
// Destino = CEP do pedido do cliente.
//
// Token: o DELA quando conectou a conta (preço real da conta dela). Sem conta
// conectada, o da plataforma — a cotação é informação; emitir e pagar a
// etiqueta continua sendo dela, pela conta dela. Antes disto, 44 dos 47
// aprovados abriam o modal e só viam "conecte sua conta".
//
// Acesso por uuid da oferta ACEITA — mesmo padrão capability da página de orçamento.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { cotarFrete, tokenDaPlataforma, tokenDoFornecedor } from '@/app/lib/melhorenvio'
import { AVISO_COTACAO, MIN_ALTURA_CM, MIN_COMPRIMENTO_CM, MIN_LARGURA_CM } from '@/app/lib/cotacao-frete'

export const runtime = 'nodejs'
export const maxDuration = 30

// Os pisos são os dos Correios (ver cotacao-frete.ts); acima da API, em
// português e dizendo QUAL medida — o "Too small: expected number to be >=13"
// que a confecção via aqui era o zod falando inglês sobre um campo sem nome.
const VolumeSchema = z.object({
  altura: z
    .number('Altura da caixa em cm.')
    .min(MIN_ALTURA_CM, `Altura mínima dos Correios: ${MIN_ALTURA_CM} cm.`)
    .max(150, 'Altura máxima: 150 cm.'),
  largura: z
    .number('Largura da caixa em cm.')
    .min(MIN_LARGURA_CM, `Largura mínima dos Correios: ${MIN_LARGURA_CM} cm.`)
    .max(150, 'Largura máxima: 150 cm.'),
  comprimento: z
    .number('Comprimento da caixa em cm.')
    .min(MIN_COMPRIMENTO_CM, `Comprimento mínimo dos Correios: ${MIN_COMPRIMENTO_CM} cm.`)
    .max(150, 'Comprimento máximo: 150 cm.'),
  peso: z.number('Peso em kg.').min(0.01, 'Peso mínimo: 10 g por caixa.').max(300, 'Peso máximo: 300 kg por caixa.'),
})
const BodySchema = z.object({
  ofertaId: z.string().uuid(),
  volumes: z.array(VolumeSchema).min(1, 'Informe ao menos uma caixa.').max(20, 'No máximo 20 caixas por cotação.'),
  seguroCentavos: z.number().int().min(0).default(0),
  cepOrigem: z.string().optional(),
})

export async function POST(req: Request) {
  let bruto: unknown
  try { bruto = await req.json() } catch { return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 }) }
  const p = BodySchema.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: p.error.issues[0]?.message ?? 'Dados inválidos' }, { status: 400 })

  const { data: oferta, error: eOferta } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('id, fornecedor_id, pedido_id, status')
    .eq('id', p.data.ofertaId)
    .maybeSingle<{ id: string; fornecedor_id: string; pedido_id: string; status: string }>()
  if (eOferta) return NextResponse.json({ erro: 'Não deu pra ler a oferta agora. Tente de novo.' }, { status: 500 })
  if (!oferta || oferta.status !== 'aceita') {
    return NextResponse.json({ erro: 'Oferta não encontrada ou não aceita.' }, { status: 404 })
  }

  const [{ data: fornecedor }, { data: pedido }] = await Promise.all([
    supabaseAdmin.from('leads_fornecedores').select('cep').eq('id', oferta.fornecedor_id).maybeSingle<{ cep: string | null }>(),
    supabaseAdmin.from('pedidos_assistente').select('cep').eq('id', oferta.pedido_id).maybeSingle<{ cep: string | null }>(),
  ])

  const cepCadastro = (fornecedor?.cep ?? '').replace(/\D/g, '')
  const cepInformado = (p.data.cepOrigem ?? '').replace(/\D/g, '')
  if (cepInformado && cepInformado.length !== 8) {
    return NextResponse.json({ erro: 'O CEP de origem precisa ter 8 dígitos (ex.: 50000-000).' }, { status: 400 })
  }
  const cepOrigem = cepInformado || cepCadastro
  const cepDestino = (pedido?.cep ?? '').replace(/\D/g, '')
  if (cepOrigem.length !== 8) {
    return NextResponse.json({ erro: 'Informe o CEP de onde a encomenda sai.', pedirCep: true }, { status: 409 })
  }
  if (cepDestino.length !== 8) {
    return NextResponse.json({ erro: 'O pedido do cliente está sem CEP de entrega.' }, { status: 409 })
  }

  // Pergunta uma vez, grava: a próxima cotação já vem preenchida.
  if (cepInformado && cepInformado !== cepCadastro) {
    const { error } = await supabaseAdmin.from('leads_fornecedores').update({ cep: cepInformado }).eq('id', oferta.fornecedor_id)
    if (error) console.error('[frete/cotar] não gravou o CEP de origem no cadastro', { fornecedorId: oferta.fornecedor_id, error })
  }

  const tokenDela = await tokenDoFornecedor(oferta.fornecedor_id)
  const token = tokenDela ?? (await tokenDaPlataforma())
  if (!token) {
    return NextResponse.json(
      { erro: 'A cotação está indisponível agora. Conecte sua conta do Melhor Envio ou tente mais tarde.', reconectar: true },
      { status: 502 }
    )
  }
  const estimativa = !tokenDela

  const r = await cotarFrete({
    token,
    cepOrigem,
    cepDestino,
    volumes: p.data.volumes,
    seguroCentavos: p.data.seguroCentavos,
  })
  if (!r.ok) {
    // "Reconectar" só faz sentido pra quem tem conta: sem conta, o erro é da plataforma.
    return NextResponse.json({ erro: r.erro, reconectar: !estimativa && (r.reconectar ?? false) }, { status: 502 })
  }

  return NextResponse.json({
    ok: true,
    servicos: r.servicos,
    cepOrigem,
    cepDestino,
    estimativa,
    aviso: estimativa ? AVISO_COTACAO : null,
  })
}
