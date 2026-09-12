// app/lib/verificar-mockup.ts
// ============================================================================
// A IMAGEM CONFERE COM O QUE O CLIENTE PEDIU? — 12/09/2026.
//
// O gerador de mockup erra em silêncio. A Ana Vitória ia receber uma peça de
// manga longa num pedido que dizia "manga curta", e a gente só descobriu porque
// o Fernando abriu o PDF na mão. Antes disso, o Wesley. O prompt está certo, o
// modelo é que não obedece sempre — e ninguém no caminho olha a imagem.
//
// Este arquivo olha. É UMA chamada de visão, com lista binária fechada, saída
// estruturada, sem ferramenta e sem laço. É FUNÇÃO, não agente: quem regenera é
// quem chamou. No minuto em que este código ganhar um laço e o poder de chamar o
// gerador, ele vira um segundo agente com orçamento próprio e ninguém olhando.
//
// O QUE ELE NÃO CHECA, DE PROPÓSITO:
//   • material ("100% algodão penteado fio 30/1") — não se vê numa imagem.
//     Perguntar geraria divergência falsa, e divergência falsa custa duas
//     gerações e um pedido adiado.
//   • qualquer atributo fora do vocabulário fechado abaixo. Descrição que diz
//     "gola esporte" simplesmente não vira pergunta — a lista encolhe, não vira
//     pergunta aberta. Lista aberta é como o verificador começa a alucinar
//     defeito.
//
// DIREÇÃO DA FALHA: verificador fora do ar **não** bloqueia a imagem. A trava
// cega aqui não é de segurança, é de qualidade — travar tudo quando a Anthropic
// pisca deixaria o cliente sem prévia nenhuma, que é pior que a prévia sem
// conferência. O resultado devolve `verificada: false` pra quem chamou saber a
// diferença entre "conferi e está limpa" e "não consegui conferir".
// ============================================================================

import Anthropic from '@anthropic-ai/sdk'
import { registrarUsoIa } from './uso-ia'

const MODELO = 'claude-sonnet-4-6'
/** A imagem já é o grosso da entrada; a resposta é uma lista de booleanos. */
const MAX_TOKENS = 400

export type Atributo = {
  /** Identificador curto que vira nome de campo no schema da resposta. */
  chave: string
  /** O que o pedido diz. Entra na pergunta e na mensagem de divergência. */
  esperado: string
}

export type ResultadoVerificacao =
  | { verificada: false; motivo: string }
  | { verificada: true; divergencias: string[] }

// ============================================================================
// VOCABULÁRIO FECHADO.
//
// Ordem importa: a negativa vem antes da afirmativa dentro da mesma chave, senão
// "sem bolso" casa com /bolso/ e o esperado sai invertido — o verificador então
// reprova a imagem CERTA, que é o pior defeito possível aqui.
// ============================================================================
const VOCABULARIO: { chave: string; padrao: RegExp; esperado: string }[] = [
  { chave: 'manga', padrao: /\b(sem\s*mangas?|regata|cavada)\b/i, esperado: 'sem manga' },
  { chave: 'manga', padrao: /\bmangas?\s*3\s*\/\s*4\b/i, esperado: 'manga 3/4' },
  { chave: 'manga', padrao: /\bmangas?\s*(curtas?)\b/i, esperado: 'manga curta' },
  { chave: 'manga', padrao: /\bmangas?\s*(longas?|compridas?)\b/i, esperado: 'manga longa' },
  { chave: 'gola', padrao: /\bgola\s*v\b/i, esperado: 'gola V' },
  { chave: 'gola', padrao: /\bgola\s*(carecas?|redondas?)\b/i, esperado: 'gola careca (redonda)' },
  { chave: 'gola', padrao: /\bgola\s*polo\b/i, esperado: 'gola polo' },
  { chave: 'capuz', padrao: /\bsem\s*capuz\b/i, esperado: 'sem capuz' },
  { chave: 'capuz', padrao: /\b(com\s*capuz|capuz|canguru)\b/i, esperado: 'com capuz' },
  { chave: 'bolso', padrao: /\bsem\s*bolsos?\b/i, esperado: 'sem bolso' },
  { chave: 'bolso', padrao: /\bbolsos?\b/i, esperado: 'com bolso' },
]

/**
 * O que a peça deve ser, já resolvido pelo chamador.
 *
 * Recebe primitivos em vez de `LinhaMockup` de propósito: `mockup-pedido.ts`
 * importa daqui, então importar de lá fecharia um ciclo. `cor` chega já limpa
 * (`corLimpa`) e `estampado` já decidido (`ehEstampado`) — as duas regras moram
 * lá e não devem ter uma segunda versão aqui.
 */
export type PedidoDaPeca = {
  modelo?: string | null
  /** Já passada por `corLimpa`. */
  cor?: string | null
  descricao?: string | null
  /** Já decidido por `ehEstampado`. */
  estampado: boolean
}

/**
 * A lista binária, montada NO CÓDIGO a partir do pedido.
 *
 * Os campos estruturados (`modelo`, `cor`, `estampado`) saem direto. O resto
 * mora em texto livre: "manga curta" não é coluna, está dentro de `descricao`
 * — foi justamente o atributo que queimou dois pedidos. Daí o extrator de
 * vocabulário fechado acima, em vez de mandar a descrição inteira pro
 * verificador julgar.
 */
export function atributosEsperados(p: PedidoDaPeca): Atributo[] {
  const lista: Atributo[] = []

  const modelo = (p.modelo || '').trim()
  if (modelo) lista.push({ chave: 'modelo', esperado: modelo })

  const cor = (p.cor || '').trim()
  if (cor) lista.push({ chave: 'cor', esperado: cor })

  lista.push({
    chave: 'estampa',
    esperado: p.estampado ? 'com estampa ou bordado aplicado' : 'lisa, sem estampa e sem bordado',
  })

  const texto = `${modelo} ${p.descricao || ''}`
  const vistas = new Set<string>()
  for (const v of VOCABULARIO) {
    if (vistas.has(v.chave)) continue
    if (v.padrao.test(texto)) {
      vistas.add(v.chave)
      lista.push({ chave: v.chave, esperado: v.esperado })
    }
  }

  return lista
}

/** Frase curta pro reforço do prompt e pro aviso na tela. */
export function textoDaDivergencia(a: Atributo): string {
  return `${a.chave}: o pedido é "${a.esperado}" e a imagem não confere`
}

/**
 * Olha a imagem e responde um booleano por atributo.
 *
 * Recebe os BYTES, não a referência do bucket: a verificação acontece antes de
 * guardar. Prévia reprovada não chega a virar arquivo — nem no storage, nem no
 * `mockups[i].ia`.
 */
export async function verificarMockup(params: {
  base64: string
  mime: string
  atributos: Atributo[]
  rota: string
}): Promise<ResultadoVerificacao> {
  const { base64, mime, atributos, rota } = params
  if (atributos.length === 0) return { verificada: true, divergencias: [] }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { verificada: false, motivo: 'ANTHROPIC_API_KEY ausente' }

  const MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  if (!MIMES.includes(mime)) return { verificada: false, motivo: `formato não suportado: ${mime}` }

  // Um campo booleano por atributo. O schema É a lista binária: o modelo não
  // tem onde escrever prosa, então não tem como inventar um defeito que não
  // perguntamos.
  const propriedades: Record<string, { type: 'boolean'; description: string }> = {}
  for (const a of atributos) {
    propriedades[a.chave] = {
      type: 'boolean',
      description: `true se a peça na imagem é/tem "${a.esperado}". false se claramente não é.`,
    }
  }

  try {
    const client = new Anthropic({ apiKey })
    const resposta = await client.messages.create({
      model: MODELO,
      max_tokens: MAX_TOKENS,
      tools: [
        {
          name: 'conferir',
          description: 'Responde um booleano por atributo conferido na imagem.',
          input_schema: {
            type: 'object',
            properties: propriedades,
            required: atributos.map((a) => a.chave),
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'conferir' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mime as 'image/png', data: base64 } },
            {
              type: 'text',
              text:
                'Esta é a prévia de uma peça de roupa gerada por IA para um pedido de confecção. ' +
                'Confira cada atributo contra a imagem e responda com a ferramenta.\n\n' +
                'NA DÚVIDA, RESPONDA true. Só responda false quando a imagem contradiz o atributo de ' +
                'forma clara e visível — ângulo ruim, recorte ou peça dobrada não são contradição. ' +
                'Um false custa duas gerações novas ao cliente.\n\n' +
                atributos.map((a) => `- ${a.chave}: "${a.esperado}"`).join('\n'),
            },
          ],
        },
      ],
    })

    void registrarUsoIa(rota, MODELO, resposta.usage)

    const bloco = resposta.content.find((c) => c.type === 'tool_use')
    if (!bloco || bloco.type !== 'tool_use') return { verificada: false, motivo: 'sem resposta estruturada' }

    const dados = bloco.input as Record<string, unknown>
    const divergencias: string[] = []
    for (const a of atributos) {
      // Só `false` explícito conta. Campo faltando ou com lixo é "não sei", e
      // "não sei" não reprova — a mesma direção do parágrafo do topo.
      if (dados[a.chave] === false) divergencias.push(textoDaDivergencia(a))
    }
    return { verificada: true, divergencias }
  } catch (e) {
    return { verificada: false, motivo: e instanceof Error ? e.message : String(e) }
  }
}
