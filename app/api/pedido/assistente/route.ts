// app/api/pedido/assistente/route.ts
// ============================================================================
// POST /api/pedido/assistente — captação de pedido via chat assistido (Etapa 1).
//
// Server-side only. Stateless: o histórico inteiro vem no body a cada chamada.
// O modelo é o OPERADOR e responde SOMENTE com JSON (contrato abaixo). A rota
// faz parse defensivo (stripa cercas, valida com zod) e, em falha, devolve uma
// pergunta de fallback preservando o estado anterior do pedido.
//
// Modelo de dados: multi-linha. Cada LINHA é um produto homogêneo:
//   { modelo, cor, material, total, tamanhos:[{tamanho,qtd}], descricao }
// Cores diferentes => linhas diferentes. Depois das linhas, coleta CONTATO
// (nome, telefone, email, cep, complemento), uma pergunta por vez.
//
// NÃO persiste nada — a gravação acontece em /api/pedido/assistente/criar
// quando o fluxo fica completo.
// ============================================================================

import Anthropic from '@anthropic-ai/sdk'
import { buscarEnderecoCep, type EnderecoCep } from '@/app/lib/cep'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { validarWhatsApp, normalizarWhatsApp } from '@/app/lib/phone'
import { hintsTecidoTexto } from '@/app/lib/tecidos'

export const runtime = 'nodejs'

const MODELO = 'claude-sonnet-4-6'
// O modelo devolve o PEDIDO INTEIRO em JSON a cada turno — pedidos grandes
// (muitas linhas/descrições) estouravam 1300 tokens, a resposta vinha truncada
// e o parse caía no fallback "me perdi" em loop. 4096 dá folga.
const MAX_TOKENS = 4096
const TEMPERATURE = 0.4
const JANELA_MODELO = 60 // últimas N mensagens enviadas ao modelo (chat ilimitado p/ o cliente)

// ----------------------------------------------------------------------------
// Tipos do contrato
// ----------------------------------------------------------------------------
type Tamanho = { tamanho: string; qtd: number | null }
type Linha = {
  modelo: string | null
  cor: string | null
  material: string | null
  publico: string | null
  total: number | null
  tamanhos: Tamanho[]
  estampado: boolean | null
  descricao: string | null
}
type Contato = {
  nome: string | null
  telefone: string | null
  email: string | null
  cep: string | null
  complemento: string | null
  logradouro: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  prazoDias: number | null
}
type Pedido = { linhas: Linha[]; contato: Contato }

const CONTATO_VAZIO: Contato = { nome: null, telefone: null, email: null, cep: null, complemento: null, logradouro: null, bairro: null, cidade: null, uf: null, prazoDias: null }
const PEDIDO_VAZIO: Pedido = { linhas: [], contato: { ...CONTATO_VAZIO } }

const PERGUNTA_FALLBACK =
  'Desculpa, me perdi aqui. Pode me contar de novo o que você precisa produzir? (modelo, cor e quantidade)'

// Fallback que NÃO perde o fio: se já existe pedido montado, avisa que está
// tudo salvo e pede só pra repetir o último ajuste (em vez de recomeçar).
function mensagemFallback(p: Pedido): string {
  const n = p.linhas.length
  if (n === 0) return PERGUNTA_FALLBACK
  const pecas = p.linhas.reduce((a, l) => a + (l.total ?? 0), 0)
  return `Opa, tive um soluço pra processar essa última mensagem — mas relaxa: seu pedido continua salvo (${n} ${n === 1 ? 'produto' : 'produtos'}${pecas > 0 ? `, ${pecas} peças` : ''}, confere no resumo). Me manda de novo só o último ajuste — se for coisa grande, pode mandar em partes. 🙏`
}

// ----------------------------------------------------------------------------
// Schemas zod (parse tolerante: um campo torto vira null, não derruba o turno)
// ----------------------------------------------------------------------------
const numTolerante = z.preprocess((v) => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}, z.number().nullable()).catch(null)

const TamanhoSchema = z.object({
  tamanho: z.string().catch(''),
  qtd: numTolerante,
}).catch({ tamanho: '', qtd: null })

const LinhaSchema = z.object({
  modelo: z.string().nullable().catch(null),
  cor: z.string().nullable().catch(null),
  material: z.string().nullable().catch(null),
  publico: z.string().nullable().catch(null),
  total: numTolerante,
  tamanhos: z.array(TamanhoSchema).catch([]),
  estampado: z.boolean().nullable().catch(null),
  descricao: z.string().nullable().catch(null),
}).catch({ modelo: null, cor: null, material: null, publico: null, total: null, tamanhos: [], estampado: null, descricao: null })

const ContatoSchema = z.object({
  nome: z.string().nullable().catch(null),
  telefone: z.string().nullable().catch(null),
  email: z.string().nullable().catch(null),
  cep: z.string().nullable().catch(null),
  complemento: z.string().nullable().catch(null),
  logradouro: z.string().nullable().catch(null),
  bairro: z.string().nullable().catch(null),
  cidade: z.string().nullable().catch(null),
  uf: z.string().nullable().catch(null),
  prazoDias: numTolerante,
}).catch({ ...CONTATO_VAZIO })

const PedidoModeloSchema = z.object({
  linhas: z.array(LinhaSchema).catch([]),
  contato: ContatoSchema.default({ ...CONTATO_VAZIO }),
}).catch({ ...PEDIDO_VAZIO })

const CorOpcaoSchema = z.object({
  nome: z.string().catch(''),
  hex: z.string().catch(''),
}).catch({ nome: '', hex: '' })

const CoresSchema = z.object({
  termo: z.string().catch(''),
  opcoes: z.array(CorOpcaoSchema).catch([]),
}).nullable().catch(null)

const RespostaModeloSchema = z.object({
  mensagem: z.string().min(1),
  cores: CoresSchema.optional(),
  pedido: PedidoModeloSchema.default({ ...PEDIDO_VAZIO }),
})

const BlocoTextoSchema = z.object({ type: z.literal('text'), text: z.string() })
const BlocoImagemSchema = z.object({ type: z.literal('image_url'), url: z.string() })
const ConteudoSchema = z.union([z.string(), z.array(z.union([BlocoTextoSchema, BlocoImagemSchema]))])
const MensagemSchema = z.object({ role: z.enum(['user', 'assistant']), content: ConteudoSchema })
type Conteudo = z.infer<typeof ConteudoSchema>
type ImgMedia = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

function textoDoConteudo(c: Conteudo): string {
  if (typeof c === 'string') return c
  return c.filter((b): b is { type: 'text'; text: string } => b.type === 'text').map((b) => b.text).join(' ')
}
function paraConteudoAnthropic(c: Conteudo): Anthropic.Messages.MessageParam['content'] {
  if (typeof c === 'string') return c
  const blocks: Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: ImgMedia; data: string } }> = []
  for (const b of c) {
    if (b.type === 'text') { if (b.text) blocks.push({ type: 'text', text: b.text }) }
    else {
      const m = /^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/.exec(b.url)
      if (m) blocks.push({ type: 'image', source: { type: 'base64', media_type: m[1] as ImgMedia, data: m[2] } })
    }
  }
  return (blocks.length ? blocks : '') as Anthropic.Messages.MessageParam['content']
}
const ContextoSchema = z.object({
  categoria: z.string().nullable().optional(),
  totalPecas: z.number().nullable().optional(),
  edicao: z.boolean().nullable().optional(),
  produtos: z.array(z.string()).nullable().optional(),
}).nullable().optional()
const BodySchema = z.object({
  messages: z.array(MensagemSchema),
  modo: z.enum(['completo', 'alinhar']).optional(),
  contexto: ContextoSchema,
})

// ----------------------------------------------------------------------------
// System prompt (pt-BR) — o assistente é a BALIZA do pedido
// ----------------------------------------------------------------------------
const SYSTEM_PROMPT = `Você é o assistente de pedidos da Confeccione, plataforma que conecta quem precisa produzir roupas E brindes personalizados/artigos de gráfica a confecções e gráficas parceiras. Seu trabalho é GUIAR o cliente a montar o pedido dele, do jeito certo, conversando de forma simples, calorosa e objetiva, em português do Brasil. UMA pergunta por vez (nunca despeje várias perguntas juntas) — o site não pode ter fricção, senão o cliente desiste.

VOCÊ É A BALIZA. O cliente quase nunca dá todos os detalhes sozinho. Ex.: "quero uma camisa de algodão estampada" não basta. Você precisa puxar, com naturalidade e uma pergunta por vez: o MODELO, a COR, o MATERIAL, a QUANTIDADE total e — quando for roupa — a divisão por TAMANHO, além dos detalhes da personalização/arte. Não invente dados: se não sabe, pergunte.

DOIS TIPOS DE PRODUTO (a conversa muda conforme o tipo):
- VESTUÁRIO (tshirt, oversized, regata, polo, camisa, moletom, jaqueta, calça, short, vestido, boné, bolsa…): fluxo completo — cor, material/tecido, PÚBLICO, quantidade, divisão por TAMANHO (P/M/G/GG…) e se é lisa, estampada ou bordada (posição da arte: frente, costas, manga).
- BRINDE / ARTIGO DE GRÁFICA (caneca, copo, copo térmico, garrafa, squeeze, chaveiro, crachá, cordão de crachá, calendário, agenda, bloco, estojo, pasta, porta-cartão, lápis, caneta, mousepad, botton, adesivo, sacola, necessaire…): NÃO pergunte público nem grade de tamanhos — preencha "publico": "unissex" e "tamanhos": []. Pergunte: COR, MATERIAL quando relevante (cerâmica, vidro, inox, plástico, PVC, couro sintético…), CAPACIDADE/medida quando fizer sentido (ex.: caneca 325ml, squeeze 500ml — guarde na "descricao"), QUANTIDADE total e a PERSONALIZAÇÃO (vai logo/arte? impressão, sublimação ou gravação; onde fica). "estampado": true se leva arte/logo/impressão, false se liso. Aceitamos os dois tipos no MESMO pedido (ex.: 200 camisetas + 200 canecas do evento) — cada produto é uma linha.

ESTRUTURA POR LINHA DE PRODUTO. Cada "linha" é um produto homogêneo: mesmo modelo, mesma cor, mesmo material. Regras:
- Se o cliente quer a MESMA peça em CORES diferentes, isso vira LINHAS diferentes (ex.: 10 pretas + 10 azuis = 2 linhas).
- Para cada linha, descubra: modelo, cor, material, quantidade total e SE O PRODUTO É LISO OU PERSONALIZADO. Em VESTUÁRIO, pergunte também o PÚBLICO com naturalidade ("É feminino, masculino, infantil ou unissex?" — a modelagem muda bastante; preencha "publico"; se não fizer diferença, "unissex") e a divisão por tamanho. Em BRINDE/GRÁFICA, pule público e tamanhos (regra acima). A pergunta liso × personalizado é importante porque MUDA O PREÇO ("Vai ser liso ou personalizado com estampa/bordado/impressão?"): preencha "estampado": true quando levar estampa, bordado, impressão ou gravação; false quando liso. Guarde em "descricao" os detalhes (tipo de personalização, posição da arte, capacidade/medida, arte própria etc.).
- COR / TONALIDADE: quando o cliente mencionar uma cor que NÃO seja exatamente preto ou branco (ex.: vermelho, azul, verde, rosa, cinza…), NÃO assuma o tom — confecção é cheia de variação (pediu vermelho e vem vinho). Ofereça 5 TONALIDADES bem espaçadas, do mais claro ao mais escuro, preenchendo o campo "cores": {"termo": "<a cor que ele falou>", "opcoes": [5x {"nome": "<nome curto do tom>", "hex": "#RRGGBB"}]}. Use hexes REAIS e bem distribuídos na escala daquela cor (não tons quase iguais). Na "mensagem", peça pra ele escolher um tom (ou descrever melhor). Quando ele escolher (ou disser o tom), registre em "cor" da linha o nome do tom + o hex, ex.: "vermelho carmim (#9B1B30)". Use "cores" SOMENTE no turno em que está oferecendo a escolha de tom; nos demais turnos deixe null.
- Tamanhos (SÓ vestuário): pergunte primeiro QUANTAS peças no total dessa linha, depois quantas de cada tamanho (P, M, G, GG, etc.). Confira se a soma dos tamanhos bate com o total; se não bater, avise gentil e ajuste. Em brindes/gráfica: só o total ("tamanhos": []).
- Quando uma linha ficar completa, pergunte se ele quer adicionar outro produto/cor ou se o pedido está completo.

FLUXO EM DUAS FASES:
1) PRODUTO: monte as linhas até o cliente dizer que terminou de descrever os produtos.
2) CONTATO: só depois das linhas, colete UMA pergunta por vez, NESTA ordem: PRAZO de produção, nome, telefone (WhatsApp), e-mail, CEP, complemento (número/apto/referência). Não peça contato antes de ter pelo menos uma linha minimamente completa.

PRAZO: pergunte "Para quando você precisa das peças prontas?" e registre em "prazoDias" o número de dias até a data desejada (estime a partir da resposta — ex.: "semana que vem" ≈ 7, "uns 10 dias" = 10, "fim do mês" calcule). NÃO comente nada sobre preço/adicional por prazo — é interno. Se o cliente der uma data, converta pra dias a partir de hoje.

FRETE: o frete NÃO entra no pedido agora. Quando o cliente perguntar (ou ao finalizar), explique de forma simples: "O frete é à parte — assim que a produção ficar pronta, a gente te envia as opções de transporte e prazos, você escolhe a que preferir e paga o frete na hora do envio."

REGRAS DE CONFIABILIDADE DO CONTATO:
- TELEFONE (WhatsApp): exija SEMPRE com DDD. Se o cliente mandar um número curto/sem DDD ou claramente incompleto, NÃO aceite — peça com gentileza o WhatsApp COM DDD (ex.: (81) 99999-9999) e só avance quando tiver DDD. Confirme repetindo o número formatado.
- CEP: peça só o CEP (8 dígitos). O sistema preenche o endereço automaticamente (rua, bairro, cidade/UF) — você NÃO precisa perguntar rua/bairro/cidade. Quando o endereço aparecer no resumo, confirme rapidinho ("É na [rua], [bairro], [cidade]/[UF]?") e pergunte só o NÚMERO e complemento (apto/referência). Se o CEP não trouxer endereço, peça o CEP de novo ou o endereço manualmente.

Quando tudo estiver coletado (linhas + contato), faça uma confirmação curta e simpática do resumo e diga que ele já pode prosseguir para ver a pré-visualização dos produtos.

A cada resposta, devolva SOMENTE um JSON válido (sem markdown, sem cercas de código, sem texto fora dele), com o PEDIDO INTEIRO e atualizado neste formato exato:
{"mensagem": string, "cores": {"termo": string, "opcoes": [{"nome": string, "hex": string}]} | null, "pedido": {"linhas": [{"modelo": string|null, "cor": string|null, "material": string|null, "publico": "feminino"|"masculino"|"infantil"|"unissex"|null, "total": number|null, "tamanhos": [{"tamanho": string, "qtd": number|null}], "estampado": boolean|null, "descricao": string|null}], "contato": {"nome": string|null, "telefone": string|null, "email": string|null, "cep": string|null, "complemento": string|null, "prazoDias": number|null}}}

Regras do JSON:
- "mensagem" é só o que você fala com o cliente (a próxima pergunta ou a confirmação). Nunca coloque JSON dentro da mensagem.
- Devolva SEMPRE o pedido completo com TODAS as linhas já coletadas (não só a última) e o contato preenchido até aqui.
- "modelo" em texto livre e minúsculo (ex.: "tshirt", "polo", "boné", "caneca", "squeeze", "chaveiro", "crachá", "pasta"). "cor" e "material" em texto livre.
- "total" é a quantidade de unidades daquela linha. "tamanhos" é a divisão por tamanho (cada item {tamanho, qtd}); se ainda não sabe — ou se for brinde/gráfica — deixe [].
- "publico": "feminino", "masculino", "infantil" ou "unissex" (null se ainda não perguntou; em brinde/gráfica preencha direto "unissex" sem perguntar). Afeta a modelagem do mockup, não o preço.
- "estampado" é booleano: true se o produto leva estampa, bordado, impressão ou gravação; false se liso; null se ainda não perguntou. Isso define a faixa de preço (liso vs personalizado).
- "cores": só preencha quando estiver oferecendo 5 tonalidades de uma cor (hexes #RRGGBB reais, claro→escuro); nos outros turnos é null. A escolha final vai pro campo "cor" da linha (nome do tom + hex).
- "prazoDias" (dentro de contato): número de dias de produção que o cliente precisa; null se ainda não perguntou.
- "descricao" guarda detalhes úteis da linha: estampa/bordado, posição da arte (frente/costas/manga), observações.
- Campos que você ainda não perguntou ficam null. Não preencha contato com placeholders.
- SEJA CONCISO no JSON: "descricao" com no máximo ~140 caracteres por linha (resuma; não repita modelo/cor/material/tamanhos que já estão nos outros campos). Em pedidos com MUITAS linhas, mantenha a "mensagem" curta — o JSON precisa caber INTEIRO na resposta.`

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function extrairJson(bruto: string): string {
  let s = bruto.trim()
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const ini = s.indexOf('{')
  const fim = s.lastIndexOf('}')
  if (ini !== -1 && fim !== -1 && fim > ini) s = s.slice(ini, fim + 1)
  return s
}

function textoDaResposta(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
}

type Cores = { termo: string; opcoes: Array<{ nome: string; hex: string }> } | null

function sanitizarCores(c: unknown): Cores {
  const obj = c as { termo?: unknown; opcoes?: unknown } | null | undefined
  if (!obj || !Array.isArray(obj.opcoes)) return null
  const hexRe = /^#[0-9a-fA-F]{6}$/
  const opcoes = (obj.opcoes as Array<{ nome?: unknown; hex?: unknown }>)
    .map((o) => ({ nome: String(o?.nome ?? '').trim(), hex: String(o?.hex ?? '').trim() }))
    .filter((o) => hexRe.test(o.hex))
    .slice(0, 5)
    .map((o) => ({ nome: o.nome || o.hex, hex: o.hex }))
  if (opcoes.length < 2) return null
  return { termo: String(obj.termo ?? '').trim(), opcoes }
}

function normalizarPedido(p: Pedido): Pedido {
  const linhas = (p.linhas ?? [])
    .map((l) => ({
      modelo: l.modelo ? l.modelo.trim() || null : null,
      cor: l.cor ? l.cor.trim() || null : null,
      material: l.material ? l.material.trim() || null : null,
      publico: l.publico ? l.publico.trim().toLowerCase() || null : null,
      total: typeof l.total === 'number' && l.total > 0 ? Math.round(l.total) : null,
      tamanhos: (l.tamanhos ?? [])
        .map((t) => ({ tamanho: (t.tamanho ?? '').trim(), qtd: typeof t.qtd === 'number' && t.qtd > 0 ? Math.round(t.qtd) : null }))
        .filter((t) => t.tamanho.length > 0),
      estampado: typeof l.estampado === 'boolean' ? l.estampado : null,
      descricao: l.descricao ? l.descricao.trim() || null : null,
    }))
    .filter((l) => l.modelo || l.cor || l.material || l.total || l.tamanhos.length > 0 || l.descricao)
  const c = p.contato ?? { ...CONTATO_VAZIO }
  const norm = (v: string | null) => (v && v.trim() ? v.trim() : null)
  const contato: Contato = {
    nome: norm(c.nome),
    telefone: norm(c.telefone),
    email: norm(c.email),
    cep: norm(c.cep),
    complemento: norm(c.complemento),
    logradouro: norm(c.logradouro),
    bairro: norm(c.bairro),
    cidade: norm(c.cidade),
    uf: norm(c.uf),
    prazoDias: typeof c.prazoDias === 'number' && c.prazoDias > 0 ? Math.round(c.prazoDias) : null,
  }
  return { linhas, contato }
}

function linhaCompleta(l: Linha): boolean {
  return Boolean(l.modelo && l.cor && l.total)
}

function telefoneValido(t: string | null): boolean {
  // Exige WhatsApp brasileiro com DDD (celular). validarWhatsApp normaliza pra
  // 55+DDD+9+8díg; número sem DDD não passa.
  return Boolean(t && validarWhatsApp(t))
}

// Busca o endereço de um CEP (ViaCEP -> fallback BrasilAPI). Null se inválido.
async function buscarCep(cep: string | null | undefined): Promise<EnderecoCep | null> {
  return buscarEnderecoCep(cep)
}

// Extrai um CEP (8 dígitos) do texto mais recente do cliente.
function extrairCepDasMensagens(messages: Array<{ role: string; content: Conteudo }>): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'user') continue
    const m = /\b(\d{5})-?\s?(\d{3})\b/.exec(textoDoConteudo(messages[i].content))
    if (m) return m[1] + m[2]
  }
  return null
}

// Enriquece o endereço a partir do CEP (ViaCEP). Sobrescreve
// logradouro/bairro/cidade/uf com a fonte oficial. Não toca em complemento.
async function enriquecerEndereco(p: Pedido): Promise<Pedido> {
  const end = await buscarCep(p.contato.cep)
  if (!end) return p
  try {
    return {
      ...p,
      contato: {
        ...p.contato,
        logradouro: end.logradouro || p.contato.logradouro,
        bairro: end.bairro || p.contato.bairro,
        cidade: end.cidade || p.contato.cidade,
        uf: end.uf || p.contato.uf,
      },
    }
  } catch {
    return p
  }
}

function calcularFase(p: Pedido): 'produto' | 'contato' | 'completo' {
  const temLinha = p.linhas.length > 0 && p.linhas.some(linhaCompleta)
  if (!temLinha) return 'produto'
  const c = p.contato
  // Exige complemento (número/apto) — não fechar só com o CEP resolvido.
  // prazoDias é perguntado no fluxo, mas NÃO trava a conclusão (evita dead-end).
  const contatoOk = Boolean(c.nome && telefoneValido(c.telefone) && c.email && c.cep && c.complemento)
  return contatoOk ? 'completo' : 'contato'
}

function pedidoAnterior(messages: Array<{ role: string; content: Conteudo }>): Pedido {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'assistant') continue
    try {
      const obj = JSON.parse(extrairJson(textoDoConteudo(m.content)))
      const r = RespostaModeloSchema.safeParse(obj)
      if (r.success) return normalizarPedido(r.data.pedido)
    } catch {
      // ignora
    }
  }
  return { linhas: [], contato: { ...CONTATO_VAZIO } }
}

// ----------------------------------------------------------------------------
// Handler
// ----------------------------------------------------------------------------
export async function POST(req: Request) {
  let bodyBruto: unknown
  try {
    bodyBruto = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido no corpo.' }, { status: 400 })
  }

  const body = BodySchema.safeParse(bodyBruto)
  if (!body.success) {
    return NextResponse.json(
      { error: 'Formato esperado: { messages: [{ role, content }, ...] }' },
      { status: 400 }
    )
  }

  const { messages } = body.data
  const modo = body.data.modo ?? 'completo'
  const contexto = body.data.contexto ?? null

  // Chat ilimitado pro cliente: em vez de barrar históricos longos, mandamos só
  // as últimas JANELA_MODELO mensagens ao modelo (o pedido inteiro é
  // reconstruído do último JSON do assistente, então não perdemos estado).
  // Garante que a janela comece num turno de 'user' (exigência da API).
  const janela = messages.slice(-JANELA_MODELO)
  while (janela.length && janela[0].role === 'assistant') janela.shift()

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[pedido/assistente] ANTHROPIC_API_KEY ausente')
    return NextResponse.json({ error: 'Serviço de chat indisponível no momento.' }, { status: 500 })
  }

  const anterior = pedidoAnterior(messages)

  // CEP -> endereço oficial ANTES de chamar o modelo, pra ele confirmar a rua
  // CERTA (em vez de inventar de memória). Usa o CEP do estado anterior ou o
  // que o cliente acabou de digitar na última mensagem.
  const cepAtual = anterior.contato.cep || extrairCepDasMensagens(janela)
  const enderecoCep = await buscarCep(cepAtual)
  const hoje = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(new Date())
  const systemBlocks: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> = [
    { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: `DATA DE HOJE: ${hoje} (fuso de Brasília). Use SEMPRE esta data como referência ao calcular o prazo em dias a partir de uma data que o cliente disser. Nunca use outra data.` },
  ]
  if (enderecoCep && cepAtual) {
    const partes = [enderecoCep.logradouro, enderecoCep.bairro, [enderecoCep.cidade, enderecoCep.uf].filter(Boolean).join('/')].filter(Boolean).join(', ')
    const textoCep = enderecoCep.logradouro
      ? `ENDEREÇO OFICIAL DO CEP ${cepAtual} (fonte oficial — use EXATAMENTE este, NUNCA invente rua/bairro/cidade): ${partes}. Ao confirmar o endereço com o cliente, use estes dados literais e peça só o número e complemento.`
      : `O CEP ${cepAtual} é um CEP ÚNICO da cidade ${partes} — não existe rua cadastrada por CEP nessa cidade. Confirme a cidade com o cliente e peça o ENDEREÇO COMPLETO num só passo: rua/avenida, número e complemento ou ponto de referência (grave tudo em complemento).`
    systemBlocks.push({ type: 'text', text: textoCep })
  }

  if (modo === 'alinhar') {
    const produtosCtx = (contexto?.produtos ?? []).filter(Boolean)
    const emEdicao = Boolean(contexto?.edicao) || produtosCtx.length > 0
    const ctxTxt = contexto
      ? `O cliente JÁ sinalizou ${contexto.totalPecas ?? 'algumas'} peças${contexto.categoria ? ` da categoria "${contexto.categoria}"` : ''}.`
      : ''
    const aberturaInstr = emEdicao
      ? `ATENÇÃO — MODO AJUSTE: o pedido JÁ TEM produtos cadastrados${produtosCtx.length ? ` (${produtosCtx.join('; ')})` : ''} e eles estão no JSON do pedido. O cliente abriu o chat pra AJUSTAR algo pontual, NÃO pra recomeçar. NUNCA apague, zere nem recrie os produtos que já existem. Abra CONFIRMANDO o que já existe e perguntando o que ele quer mudar (ex.: "Você já tem [resumo curto dos produtos]. O que você quer ajustar?"). Mexa SÓ no que ele pedir e devolva SEMPRE o pedido COMPLETO (todos os produtos), com apenas o ajuste aplicado. Só adicione um produto novo se ele pedir; só remova um produto se ele pedir explicitamente. `
      : `Abra a conversa puxando disso: pergunte quantos MODELOS diferentes ele quer produzir (ou qual modelo). Depois, por modelo: a(s) cor(es) — cor diferente vira linha separada — e a divisão por tamanho. `
    const alinhar =
      `MODO ALINHAR (importante): o CONTATO, ENDEREÇO e PRAZO JÁ FORAM COLETADOS antes desta conversa — NUNCA pergunte nome, telefone, e-mail, CEP, endereço nem prazo, e deixe os campos de contato como estão. Seu trabalho aqui é organizar o pedido em linhas de produto (modelo, cor, tamanhos e tecido). ${ctxTxt} ` +
      aberturaInstr +
      `Ao perguntar o MATERIAL/tecido, SUGIRA os tecidos típicos daquele produto (use a biblioteca abaixo) e deixe claro que ele pode indicar outro se preferir. ` +
      `REGRA DE CAMPOS (siga à risca): o campo "modelo" é SÓ o tipo da peça (ex.: "moletom", "calça wide leg", "camiseta") — NUNCA coloque tecido, material, cor ou gramatura no "modelo". O tecido vai SEMPRE no campo "material". Ex.: cliente diz "moletom de algodão rosa" → modelo:"moletom", cor:"rosa", material:"algodão"; "calça wide leg de moletom" → modelo:"calça wide leg", material:"moletom". ` +
      `REGRA DE TÉCNICA (importante): estampa FULL PRINT / sublimação total SÓ funciona em POLIÉSTER (ou tecidos com alto teor de poliéster) — NÃO funciona em algodão. Se o cliente pedir full print / sublimação total em algodão (ou num produto que ele disse ser de algodão), avise gentilmente que essa técnica exige poliéster e ofereça trocar o tecido pra poliéster (ou dry/poliamida); deixe claro que estampa LOCALIZADA (silk, DTF, transfer) funciona em algodão normalmente. ` +
      `Se o cliente ENVIAR FOTO(S), ANALISE a imagem pra identificar o(s) produto(s), a cor e (quando der pra ver) o material. Se a foto mostrar um CONJUNTO/look com MAIS DE UMA peça (ex.: calça wide leg + casaco/moletom com zíper), NÃO assuma uma peça só: diga quais peças você viu e PERGUNTE se ele quer produzir o CONJUNTO COMPLETO (aí cada peça vira uma linha) ou só uma delas — só crie as linhas depois que ele confirmar. Se for uma peça só, confirme ("vi que é um(a) ___, certo?") e já preencha. ` +
      `Quando ele terminar ${emEdicao ? 'o ajuste' : 'de descrever os produtos'}, faça um resumo curto e simpático e diga que ele já pode tocar em "Concluir e ver os produtos" — NÃO peça contato.\n\n` +
      hintsTecidoTexto(contexto?.categoria ?? null)
    systemBlocks.push({ type: 'text', text: alinhar })
  }

  let texto: string
  try {
    const client = new Anthropic({ apiKey })
    const resposta = await client.messages.create({
      model: MODELO,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: systemBlocks,
      messages: janela.map((m) => ({ role: m.role, content: paraConteudoAnthropic(m.content) })),
    })
    texto = textoDaResposta(resposta.content)
    if (resposta.stop_reason === 'max_tokens') {
      console.error('[pedido/assistente] resposta TRUNCADA por max_tokens — pedido grande demais pro limite atual')
    }
  } catch (err) {
    console.error('[pedido/assistente] falha na chamada ao modelo:', err)
    return NextResponse.json({ error: 'Não consegui responder agora. Tente de novo.' }, { status: 502 })
  }

  let parsed: z.infer<typeof RespostaModeloSchema> | null = null
  try {
    const obj = JSON.parse(extrairJson(texto))
    const r = RespostaModeloSchema.safeParse(obj)
    if (r.success) parsed = r.data
  } catch {
    parsed = null
  }

  if (!parsed) {
    const anteriorEnriq = await enriquecerEndereco(anterior)
    const faseAnt = calcularFase(anteriorEnriq)
    return NextResponse.json({
      mensagem: mensagemFallback(anteriorEnriq),
      cores: null,
      pedido: anteriorEnriq,
      fase: faseAnt,
      completo: faseAnt === 'completo',
    })
  }

  const pedido = await enriquecerEndereco(normalizarPedido(parsed.pedido))
  const fase = calcularFase(pedido)
  return NextResponse.json({
    mensagem: parsed.mensagem,
    cores: sanitizarCores(parsed.cores),
    pedido,
    fase,
    completo: fase === 'completo',
  })
}
