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
// VOCABULÁRIO FECHADO — e as três armadilhas que ele levou na cara.
//
// A primeira versão reprovou 11 de 19 prévias REAIS do banco. As 11 eram falso
// positivo, e nenhuma era culpa do verificador: era a lista que estava errada.
// O que os dados de verdade mostraram:
//
//  1. PEÇA COMPOSTA. "blusa … bolso frontal; calça wide leg SEM bolsos laterais"
//     (20260900293). Uma descrição, duas peças, atributos opostos. A ordem
//     negativa-primeiro elegia "sem bolso" e reprovava a imagem CERTA, que
//     mostrava a blusa com bolso.
//     → Se o texto casa com mais de um valor da mesma chave, o atributo SAI.
//
//  2. ATRIBUTO QUALIFICADO. "Macacão … manga em apenas um ombro (assimétrico).
//     Sem manga no outro lado." (20260900282, cinco modelos). Só a negativa
//     casava, então não havia contradição pra detectar — mas "sem manga" ali é
//     sobre UM LADO, não sobre a peça.
//     → Palavra de ressalva por perto ("apenas", "outro lado", "assimétrico")
//       tira as chaves de forma do jogo.
//
//  3. NULL NÃO É "NÃO". `estampado` chega NULL e o `ehEstampado` colapsa pra
//     false — aí a lista afirmava "lisa, sem estampa" numa peça cuja descrição
//     dizia "Estampa com símbolo … centralizado na frente" (20260900277).
//     → NULL é "não sei", e "não sei" não vira afirmação.
//
// A regra que sai das três é a mesma: NA DÚVIDA, NÃO PERGUNTA. Lista que
// encolhe deixa passar um defeito de vez em quando; lista que afirma errado
// descarta a prévia certa e o cliente fica sem imagem nenhuma.
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

/** Armadilha 2: ressalva por perto derruba as chaves de forma. */
const RESSALVA = /\b(apenas|somente|s[óo]\s+um|um\s+(lado|ombro|bra[çc]o)|outro\s+lado|assim[ée]tric\w*|de\s+um\s+lado)\b/i

/** Armadilha 3: palavras que denunciam arte aplicada, mesmo com a coluna NULL. */
const FALA_DE_ARTE = /\b(estampas?|estampad\w*|bordad\w*|logo(tipo)?s?|aplica[çc][ãa]o|aplica[çc][õo]es|silk|serigrafia|s[íi]mbolo|bras[ãa]o|emblema)\b/i

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
  /**
   * O valor CRU da coluna, incluindo `null`. Não use `ehEstampado` aqui: ele
   * colapsa NULL em false, e afirmar "lisa" a partir de "não sei" foi a
   * armadilha 3 lá em cima.
   */
  estampado?: boolean | null
  /** `true` quando a linha tem estampas cadastradas (`estampas.length > 0`). */
  temEstampasCadastradas?: boolean
}

/**
 * A lista binária, montada NO CÓDIGO a partir do pedido.
 *
 * Os campos estruturados (`modelo`, `cor`, `estampado`) saem direto. O resto
 * mora em texto livre: "manga curta" não é coluna, está dentro de `descricao`
 * — foi justamente o atributo que queimou dois pedidos. Daí o extrator de
 * vocabulário fechado acima, em vez de mandar a descrição inteira pro
 * verificador julgar.
 *
 * Toda dúvida encolhe a lista. Ver as três armadilhas no comentário do
 * VOCABULARIO: cada uma delas nasceu de uma afirmação feita sem base.
 */
export function atributosEsperados(p: PedidoDaPeca): Atributo[] {
  const lista: Atributo[] = []

  const modelo = (p.modelo || '').trim()
  if (modelo) lista.push({ chave: 'modelo', esperado: modelo })

  const cor = (p.cor || '').trim()
  if (cor) lista.push({ chave: 'cor', esperado: cor })

  const texto = `${modelo} ${p.descricao || ''}`
  const falaDeArte = FALA_DE_ARTE.test(texto)

  // ESTAMPA. Três estados, não dois:
  //   • true (coluna ou estampas cadastradas) → afirma "com estampa"
  //   • false explícito e a descrição não fala de arte → afirma "lisa"
  //   • NULL, ou false brigando com a descrição → não pergunta
  const estampado = p.estampado === true || p.temEstampasCadastradas === true
  if (estampado) {
    lista.push({ chave: 'estampa', esperado: 'com estampa, bordado ou arte aplicada' })
  } else if (p.estampado === false && !falaDeArte) {
    lista.push({ chave: 'estampa', esperado: 'lisa, sem estampa e sem bordado' })
  }

  // FORMA (manga, gola, capuz, bolso). Ressalva por perto e a peça pode ser
  // assimétrica ou composta: nenhuma chave de forma é confiável no texto todo.
  if (!RESSALVA.test(texto)) {
    const porChave = new Map<string, Set<string>>()
    for (const v of VOCABULARIO) {
      if (!v.padrao.test(texto)) continue
      const s = porChave.get(v.chave) ?? new Set<string>()
      s.add(v.esperado)
      porChave.set(v.chave, s)
    }
    for (const [chave, valores] of porChave) {
      // Mais de um valor pra mesma chave = a descrição fala de duas peças (ou se
      // contradiz). Armadilha 1: escolher um dos dois reprova a imagem certa.
      if (valores.size !== 1) continue
      lista.push({ chave, esperado: [...valores][0] })
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
