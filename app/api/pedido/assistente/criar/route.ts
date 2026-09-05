// app/api/pedido/assistente/criar/route.ts
// ============================================================================
// POST /api/pedido/assistente/criar — grava o pedido montado no chat assistido.
//
// Etapa 1: apenas PERSISTE (linhas + contato) na tabela pedidos_assistente via
// service role. NÃO dispara fornecedores — a próxima etapa (visualizador) é que
// vai consumir esse registro. Idempotência leve: o cliente envia o pedido só
// quando o fluxo fica completo.
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getContaAtual } from '@/app/lib/cliente-auth'
import { normalizarWhatsApp } from '@/app/lib/phone'
import { pecaValida } from '@/app/lib/pecas'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const TamanhoSchema = z.object({
  tamanho: z.string().min(1),
  qtd: z.number().int().positive().nullable(),
})
const EstampaSchema = z.object({ posicao: z.string(), tamanho: z.string() })
const LinhaSchema = z.object({
  modelo: z.string().nullable(),
  cor: z.string().nullable(),
  material: z.string().nullable(),
  publico: z.string().nullable().optional(),
  total: z.number().int().positive().nullable(),
  tamanhos: z.array(TamanhoSchema).default([]),
  estampas: z.array(EstampaSchema).default([]),
  estampado: z.boolean().nullable().optional(),
  acabamentos: z.array(z.string()).nullable().optional(),
  categoria: z.string().nullable().optional(),
  objetivo_material: z.string().nullable().optional(),
  descricao: z.string().nullable(),
})
const ContatoSchema = z.object({
  nome: z.string().nullable(),
  telefone: z.string().nullable(),
  email: z.string().nullable(),
  cep: z.string().nullable(),
  numero: z.string().nullable().optional(),
  complemento: z.string().nullable(),
  logradouro: z.string().nullable().optional(),
  bairro: z.string().nullable().optional(),
  cidade: z.string().nullable().optional(),
  uf: z.string().nullable().optional(),
  prazoDias: z.number().int().positive().nullable().optional(),
})
const ConversaItemSchema = z.object({ role: z.enum(['user', 'assistant']), texto: z.string().max(20000) })

// Atribuição da visita (26/08/2026) — tudo opcional e nullable, e o objeto
// inteiro tem .catch(): atribuição malformada NÃO pode derrubar o pedido com
// um 400 genérico na cara do cliente. Sem atribuição, o pedido salva igual.
const AtribuicaoSchema = z
  .object({
    gclid: z.string().nullable().optional(),
    utm_source: z.string().nullable().optional(),
    utm_medium: z.string().nullable().optional(),
    utm_campaign: z.string().nullable().optional(),
    referrer: z.string().nullable().optional(),
  })
  .optional()
  .catch(undefined)

const BodySchema = z.object({
  linhas: z.array(LinhaSchema),
  contato: ContatoSchema,
  /** id do catálogo de peças (app/lib/pecas.ts) — o que o matching usa. */
  peca: z.string().max(40).nullable().optional(),
  /** Todas as peças marcadas. `peca` é a primeira delas. */
  pecas: z.array(z.string().max(40)).max(24).optional(),
  /** O que o cliente escreveu quando o catálogo não tinha a peça dele. */
  peca_outro: z.string().max(300).nullable().optional(),
  observacoes: z.string().nullable().optional(),
  conversa: z.array(ConversaItemSchema).max(600).optional(),
  atribuicao: AtribuicaoSchema,
})

/** Corte de tamanho no server — o cliente não decide o tamanho do que grava. */
function corta(v: string | null | undefined, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}

export async function POST(req: Request) {
  let bruto: unknown
  try {
    bruto = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 })
  }

  const parsed = BodySchema.safeParse(bruto)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Formato inválido do pedido.' }, { status: 400 })
  }

  const { linhas, contato } = parsed.data

  // Validação mínima: pelo menos 1 linha com identidade (modelo OU cor), e
  // contato básico.
  //
  // A QUANTIDADE DEIXOU DE SER OBRIGATÓRIA AQUI — 24/08/2026.
  // O filtro também exigia `total` ou `tamanhos`. Isso valia enquanto a home
  // perguntava a quantidade no passo 2; desde que esse campo saiu do formulário,
  // a linha chega com `total: null` e a exigência derrubaria TODO pedido vindo da
  // home, com um 400 genérico na cara do cliente.
  //
  // Quem preenche a quantidade agora é o chat de alinhamento (/alinhar/{id}),
  // que já pergunta modelo, cor, quantidade e divisão por tamanho — e que trata
  // `total` nulo como "ainda não perguntamos", não como zero.
  //
  // O que continua barrado é a linha vazia: sem modelo e sem cor não há pedido.
  const linhasValidas = linhas.filter((l) => l.modelo || l.cor)
  if (linhasValidas.length === 0) {
    return NextResponse.json(
      { error: 'Inclua pelo menos um produto.' },
      { status: 400 }
    )
  }
  if (!contato.nome || !contato.telefone || !contato.email) {
    return NextResponse.json(
      { error: 'Faltam dados de contato (nome, telefone e e-mail).' },
      { status: 400 }
    )
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(contato.email)) {
    return NextResponse.json({ error: 'E-mail inválido.' }, { status: 400 })
  }

  // Conta logada (se houver) — sem bloquear o anônimo.
  let contaId: string | null = null
  try {
    const conta = await getContaAtual()
    contaId = conta?.id ?? null
  } catch {
    contaId = null
  }

  const categoriaPedido =
    linhasValidas.find((l) => l.categoria)?.categoria ??
    (parsed.data.observacoes
      ? parsed.data.observacoes.match(/(?:Categoria|Peça):\s*(.+)/)?.[1]?.trim() || null
      : null)

  // Só entram ids que existem no catálogo: id inventado no corpo da request
  // viraria pedido que nenhum fornecedor casa, e ninguém perceberia.
  const pecas = [...new Set((parsed.data.pecas ?? []).filter(pecaValida))]
  const peca = pecaValida(parsed.data.peca)
    ? parsed.data.peca
    : (pecas[0] ?? null)

  // Texto livre: guardado como veio (só aparado). É o material bruto pra
  // decidir quais peças faltam no catálogo — normalizar aqui perderia
  // exatamente a palavra que o cliente usou, que é o dado.
  const pecaOutro = corta(parsed.data.peca_outro, 300)

  // Atribuição: é ela que responde "quais dos pedidos da semana o Ads trouxe".
  const atr = parsed.data.atribuicao

  const { data, error } = await supabase
    .from('pedidos_assistente')
    .insert({
      linhas: linhasValidas,
      gclid: corta(atr?.gclid, 120),
      utm_source: corta(atr?.utm_source, 120),
      utm_medium: corta(atr?.utm_medium, 120),
      utm_campaign: corta(atr?.utm_campaign, 160),
      referrer: corta(atr?.referrer, 300),
      categoria: categoriaPedido ?? null,
      peca,
      pecas,
      peca_outro: pecaOutro,
      nome: contato.nome,
      telefone: contato.telefone ? normalizarWhatsApp(contato.telefone) : null,
      email: contato.email,
      cep: contato.cep,
      numero: contato.numero ?? null,
      complemento: contato.complemento,
      logradouro: contato.logradouro ?? null,
      bairro: contato.bairro ?? null,
      cidade: contato.cidade ?? null,
      uf: contato.uf ?? null,
      prazo_dias: contato.prazoDias ?? null,
      observacoes: parsed.data.observacoes ?? null,
      conversa: parsed.data.conversa ?? null,
      status: 'completo',
      origem: 'home_chat',
      conta_id: contaId,
    })
    .select('id, codigo')
    .single()

  if (error || !data) {
    console.error('[pedido/assistente/criar] insert falhou:', error)
    return NextResponse.json({ error: error?.message ?? 'Erro ao salvar o pedido.' }, { status: 500 })
  }

  // Esta etapa só PERSISTE o pedido (status 'completo'). A confirmação por
  // WhatsApp ao cliente NÃO sai daqui — passou pra rota /confirmar, disparada
  // só quando o cliente clica em "Buscar fornecedor" (decisão do Fernando,
  // jul/2026: não avisar antes de ele realmente pedir pra buscar fornecedor).
  return NextResponse.json({ ok: true, id: data.id, protocolo: String(data.codigo ?? data.id), codigo: data.codigo ?? null })
}
