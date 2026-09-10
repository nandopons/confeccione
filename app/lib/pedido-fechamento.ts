// app/lib/pedido-fechamento.ts
// ============================================================================
// FECHAR O PEDIDO PELA CONVERSA (09/09/2026).
//
// O PROBLEMA
// A maior fila do funil é a entrada: pedidos em "captado" — o cliente entrou,
// deu o contato e parou antes de dizer a peça. Em 09/09 eram 38. O caminho pra
// sair dali era o cliente voltar sozinho ao site e preencher, e ele não volta.
//
// Agora o Luigi fecha o pedido conversando: define a peça pelo que o cliente
// disser, manda o resumo em PDF pra ele conferir e, com o "pode liberar",
// confirma o pedido — que é o mesmo efeito do botão "Buscar fornecedor" do
// visualizador. A partir daí o pedido entra em buscando_fornecedor e a esteira
// de ofertas roda como sempre.
//
// A CONFIRMAÇÃO É DO CLIENTE, NÃO DO AGENTE
// liberarParaFornecedores só deve ser chamada depois de o cliente ver o resumo
// e dizer que está certo. É o momento em que o pedido dele vai pro mercado —
// se sair errado, ele recebe oferta de coisa que não pediu e a gente queima a
// confiança logo na entrada.
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import { guardarImagem } from './imagens-pedido-storage'
import { salvarLinhasEditadas, type LinhaEditada } from './pedido-linhas-edicao'
import { enviarResumoPdfPedido } from './whatsapp-notify'
import type { LinhaPedido } from './pedido-assistente-oferta'

export type PecaEntrada = {
  modelo?: string | null
  cor?: string | null
  material?: string | null
  quantidade?: number | null
  descricao?: string | null
  /** feminino | masculino | infantil | unissex — muda a modelagem, não é detalhe. */
  publico?: string | null
  tamanhos?: Array<{ tamanho: string; qtd: number }> | null
}

/** Teto por foto: o que passa disso é print de tela cheia, não referência de peça. */
const MAX_FOTO_BYTES = 8 * 1024 * 1024

/**
 * Prende uma foto que chegou pelo WhatsApp a UM modelo do pedido.
 *
 * O chat do site já fazia isso pelo `fotosPorLinha`, e é o que faz a confecção
 * ver a referência do lado da peça certa em vez de uma pilha de imagens soltas.
 * Pelo WhatsApp não existia: o cliente mandava a foto da camisa que ele quer, o
 * Luigi via a imagem e sabia descrever, mas ela morria na conversa — não chegava
 * em quem vai produzir.
 *
 * O destino é `mockups[índice da linha].fotos`, o MESMO lugar que o site usa.
 * Nada de estrutura paralela: o visualizador, a oferta ao fornecedor e o PDF já
 * leem dali, então a foto do WhatsApp aparece nos três sem tocar em nenhum.
 */
export async function anexarFotoDaConversaAoModelo(params: {
  pedidoId: string
  /** Posição do modelo como o cliente conta: 1 = Modelo 1. */
  posicao: number
  /** Caminho no bucket wa-midia, da mensagem que o cliente mandou. */
  midiaPath: string
}): Promise<{ ok: boolean; erro?: string; modelo?: string; totalFotos?: number }> {
  const { data: pedido } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, linhas, mockups')
    .eq('id', params.pedidoId)
    .maybeSingle<{ id: string; linhas: unknown; mockups: Record<string, unknown> | null }>()
  if (!pedido) return { ok: false, erro: 'pedido não encontrado' }

  const linhas = Array.isArray(pedido.linhas) ? (pedido.linhas as LinhaPedido[]) : []
  const i = Math.round(params.posicao) - 1
  if (i < 0 || i >= linhas.length) {
    return { ok: false, erro: `este pedido tem ${linhas.length} modelo(s); não existe modelo ${params.posicao}` }
  }

  const { data: arquivo, error: erroDownload } = await supabaseAdmin.storage.from('wa-midia').download(params.midiaPath)
  if (erroDownload || !arquivo) return { ok: false, erro: 'não achei essa foto no histórico da conversa' }

  const bytes = Buffer.from(await arquivo.arrayBuffer())
  if (bytes.byteLength === 0) return { ok: false, erro: 'a foto veio vazia' }
  if (bytes.byteLength > MAX_FOTO_BYTES) return { ok: false, erro: 'foto muito grande' }
  const mime = arquivo.type || 'image/jpeg'
  if (!mime.startsWith('image/')) return { ok: false, erro: 'esse arquivo não é uma imagem' }

  // guardarImagem fala data URL e devolve a referência de storage que o resto
  // do sistema entende — é o ponto único onde imagem de pedido é gravada.
  const ref = await guardarImagem(`data:${mime};base64,${bytes.toString('base64')}`, pedido.id)

  type Mockup = { fotos?: string[]; ia?: unknown[]; liso?: string; arte?: string }
  const mapa: Record<string, Mockup> =
    pedido.mockups && typeof pedido.mockups === 'object' ? { ...(pedido.mockups as Record<string, Mockup>) } : {}
  const chave = String(i)
  const atual = mapa[chave] ?? {}
  const fotos = Array.isArray(atual.fotos) ? [...atual.fotos] : []
  // Mesma foto duas vezes acontece quando o cliente reenvia; não duplica.
  if (!fotos.includes(ref)) fotos.push(ref)
  // O campo legado liso/arte sai quando o modelo passa a ter lista de fotos —
  // é o que a rota de mockup do site faz, e os dois formatos não convivem.
  mapa[chave] = { ...atual, fotos }
  delete mapa[chave].liso
  delete mapa[chave].arte

  const { error } = await supabaseAdmin
    .from('pedidos_assistente')
    .update({ mockups: mapa, atualizado_em: new Date().toISOString() })
    .eq('id', pedido.id)
  if (error) return { ok: false, erro: error.message }

  const l = linhas[i]
  const nome = [l?.modelo, l?.cor].filter(Boolean).join(' ') || `modelo ${params.posicao}`
  return { ok: true, modelo: nome, totalFotos: fotos.length }
}

/**
 * Abre um pedido NOVO pra quem já está conversando no WhatsApp.
 *
 * Até 09/09/2026 o Luigi só sabia mexer em pedido que já existia. A Cybelle
 * pediu 20 camisetas com especificação inteira — bordado, patch, etiqueta, 5
 * cores, 4 tamanhos — e ele teve que devolver pro Fernando, porque o pedido
 * dela em andamento já estava em buscando_fornecedor e não dava pra empilhar
 * peça nova lá dentro. O cliente descreveu tudo e a conversa morreu na mão de
 * gente.
 *
 * NASCE PARADO, DE PROPÓSITO. Status 'completo', não 'buscando_fornecedor': o
 * pedido é criado, o cliente confere pelo PDF e só então liberarParaFornecedores
 * manda pro mercado. Criar já liberando tiraria a única conferência que existe
 * antes de o pedido virar oferta pra dezenas de confecções.
 *
 * O CADASTRO VEM DO PEDIDO ANTERIOR. Quem já pediu antes não precisa ditar
 * endereço de novo — nome, e-mail, CEP e endereço saem do pedido mais recente
 * do mesmo telefone. Se não houver, ficam nulos e o pedido segue incompleto
 * até alguém preencher, que é o comportamento normal do funil.
 */
export async function criarPedidoParaContato(params: {
  telefone: string
  nome?: string | null
  pecas: PecaEntrada[]
  prazoDias?: number | null
  observacoes?: string | null
}): Promise<{ ok: boolean; erro?: string; pedidoId?: string; codigo?: string; resumo?: string; reaproveitado?: boolean }> {
  const tel = params.telefone.replace(/\D/g, '')
  if (tel.length < 10) return { ok: false, erro: 'telefone do contato inválido' }
  if (params.pecas.length === 0) return { ok: false, erro: 'informe ao menos uma peça' }

  // Mesma lição do resumo em PDF: efeito de ferramenta se trava na ferramenta.
  // Se o modelo chamar duas vezes — porque o cliente mandou duas mensagens, ou
  // porque a rodada anterior pareceu falhar — o cliente acaba com dois pedidos
  // iguais e recebe oferta em dobro. Dentro de 15 minutos, devolve o que já foi
  // criado em vez de abrir outro.
  const tel8 = tel.slice(-8)
  const { data: recente } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, codigo')
    .like('telefone', `%${tel8}`)
    .eq('origem', 'whatsapp_luigi')
    .gte('criado_em', new Date(Date.now() - 15 * 60 * 1000).toISOString())
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; codigo: string | null }>()
  if (recente) {
    return {
      ok: true,
      reaproveitado: true,
      pedidoId: recente.id,
      codigo: recente.codigo ?? undefined,
      erro: `você já abriu o pedido ${recente.codigo ?? recente.id} pra esta pessoa há poucos minutos — use ajustar_peca_pedido nele em vez de criar outro`,
    }
  }

  const { data: anterior } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('nome, email, conta_id, cep, logradouro, numero, complemento, bairro, cidade, uf, cpf_cnpj')
    .like('telefone', `%${tel8}`)
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle<Record<string, unknown>>()

  const { data: novo, error } = await supabaseAdmin
    .from('pedidos_assistente')
    .insert({
      linhas: [],
      status: 'completo',
      origem: 'whatsapp_luigi',
      telefone: tel,
      nome: params.nome ?? (anterior?.nome as string | null) ?? null,
      email: (anterior?.email as string | null) ?? null,
      conta_id: (anterior?.conta_id as string | null) ?? null,
      cpf_cnpj: (anterior?.cpf_cnpj as string | null) ?? null,
      cep: (anterior?.cep as string | null) ?? null,
      logradouro: (anterior?.logradouro as string | null) ?? null,
      numero: (anterior?.numero as string | null) ?? null,
      complemento: (anterior?.complemento as string | null) ?? null,
      bairro: (anterior?.bairro as string | null) ?? null,
      cidade: (anterior?.cidade as string | null) ?? null,
      uf: (anterior?.uf as string | null) ?? null,
      prazo_dias: params.prazoDias ?? null,
      observacoes: params.observacoes ?? null,
    })
    .select('id, codigo')
    .single<{ id: string; codigo: string | null }>()
  if (error || !novo) return { ok: false, erro: error?.message ?? 'não foi possível abrir o pedido' }

  // As peças entram pelo mesmo caminho de sempre, que normaliza linha, calcula
  // total e devolve o resumo — não existe segunda forma de escrever peça.
  const r = await definirPecasPedido(novo.id, params.pecas)
  if (!r.ok) return { ok: false, erro: r.erro, pedidoId: novo.id, codigo: novo.codigo ?? undefined }

  return { ok: true, pedidoId: novo.id, codigo: novo.codigo ?? undefined, resumo: r.resumo }
}

/**
 * Define as peças do pedido a partir do que o cliente disse na conversa.
 * Substitui a lista inteira — é o caso do pedido que ainda está com "peça a
 * definir" ou vazio. Pra mexer numa peça já existente, o caminho é
 * ajustar_peca_pedido, que preserva lid, preço e mockups.
 */
export async function definirPecasPedido(pedidoId: string, pecas: PecaEntrada[]) {
  if (pecas.length === 0) return { ok: false as const, erro: 'informe ao menos uma peça' }

  const linhas: LinhaEditada[] = pecas.map((p) => ({
    modelo: p.modelo ?? null,
    cor: p.cor ?? null,
    material: p.material ?? null,
    total: p.quantidade ?? null,
    descricao: p.descricao ?? null,
    publico: p.publico ?? null,
    tamanhos: p.tamanhos ?? [],
    estampas: [],
    origIdx: null,
  }))

  const r = await salvarLinhasEditadas({ pedidoId, linhas, autor: 'cliente' })
  if (!r.ok) return { ok: false as const, erro: r.erro }
  return { ok: true as const, linhas: r.linhas, resumo: r.resumo }
}

/** Uma peça está completa quando dá pra uma confecção orçar: o quê, qual cor, quantas. */
export function pecaCompleta(l: LinhaPedido): boolean {
  return Boolean(l.modelo && l.cor && (l.total ?? 0) > 0)
}

/**
 * Divergências que fazem a confecção orçar errado — ou desistir de orçar.
 *
 * A mais cara é a peça que junta dois produtos: "Tshirt branca e azul marinho,
 * 3 un" não é uma peça, são duas, e cada uma tem custo e grade própria. O
 * cliente escreve assim porque pra ele é um pedido só; quem produz precisa
 * separado. Idem público: camiseta masculina e feminina têm modelagem
 * diferente, e "não informado" vira suposição do fornecedor.
 *
 * Isto não bloqueia nada — devolve o que conversar com o cliente. Quem decide
 * é ele; a gente só não deixa passar em silêncio.
 */
export type Divergencia = { posicao: number; o_que: string; pergunte: string }

const PUBLICOS = ['feminino', 'masculino', 'infantil', 'unissex']

export function revisarPecas(linhas: LinhaPedido[]): Divergencia[] {
  const achados: Divergencia[] = []

  linhas.forEach((l, i) => {
    const posicao = i + 1
    const cor = (l.cor ?? '').trim()
    const desc = (l.descricao ?? '').trim()
    const publico = ((l as { publico?: string | null }).publico ?? '').trim().toLowerCase()

    // Duas cores na mesma peça: "branca e azul marinho", "preto/branco", "azul, verde".
    if (/\s+e\s+|\s*\/\s*|\s*,\s*|\s*\+\s*/.test(cor) && cor.length > 3) {
      achados.push({
        posicao,
        o_que: `a peça ${posicao} tem mais de uma cor no mesmo item ("${cor}") — a confecção precisa de uma linha por cor pra orçar`,
        pergunte: `confirmar quantas peças de cada cor e separar em modelos diferentes`,
      })
    }

    // A descrição fala de cor ou tamanho que não está nos campos — sinal de que
    // o cliente detalhou no texto o que deveria estar estruturado.
    if (desc.length > 40 && /\b(azul|branca|branco|preta|preto|verde|vermelh|amarel|cinza|rosa)\b/i.test(desc) && cor) {
      const coresNaDesc = (desc.match(/\b(azul|branca|branco|preta|preto|verde|vermelh\w*|amarel\w*|cinza|rosa)\b/gi) ?? []).map((c) =>
        c.toLowerCase()
      )
      const distintas = new Set(coresNaDesc.map((c) => c.slice(0, 4)))
      if (distintas.size > 1) {
        achados.push({
          posicao,
          o_que: `a descrição da peça ${posicao} mistura cores diferentes ("${desc.slice(0, 90)}")`,
          pergunte: `qual peça é de qual cor e em que tamanho, pra separar direito`,
        })
      }
    }

    if (!publico || !PUBLICOS.includes(publico)) {
      achados.push({
        posicao,
        o_que: `a peça ${posicao} não diz o público (feminino, masculino, infantil ou unissex) — muda a modelagem`,
        pergunte: `se a peça é feminina, masculina, infantil ou unissex`,
      })
    }

    const somaTamanhos = (l.tamanhos ?? []).reduce((s, t) => s + (t?.qtd ?? 0), 0)
    if (somaTamanhos > 0 && (l.total ?? 0) > 0 && somaTamanhos !== l.total) {
      achados.push({
        posicao,
        o_que: `na peça ${posicao} a soma dos tamanhos (${somaTamanhos}) não bate com o total (${l.total})`,
        pergunte: `quantas peças de cada tamanho`,
      })
    }
  })

  return achados
}

export type ProntoParaLiberar =
  | { pronto: true; pecas: LinhaPedido[]; divergencias: Divergencia[] }
  | { pronto: false; falta: string; divergencias: Divergencia[] }

/**
 * O pedido está em pé pra ir aos fornecedores? Verificação explícita, e não
 * confiança no que o agente acha que preencheu.
 */
export async function conferirPedido(pedidoId: string): Promise<ProntoParaLiberar> {
  const { data } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('linhas, nome, telefone, status, pagamento_status')
    .eq('id', pedidoId)
    .maybeSingle<{
      linhas: LinhaPedido[] | null
      nome: string | null
      telefone: string | null
      status: string | null
      pagamento_status: string | null
    }>()
  if (!data) return { pronto: false, falta: 'pedido não encontrado', divergencias: [] }
  if (data.pagamento_status === 'pago') return { pronto: false, falta: 'pedido já pago', divergencias: [] }
  if (data.status === 'cancelado') return { pronto: false, falta: 'pedido cancelado', divergencias: [] }

  const linhas = Array.isArray(data.linhas) ? data.linhas : []
  if (linhas.length === 0) return { pronto: false, falta: 'nenhuma peça definida', divergencias: [] }

  const divergencias = revisarPecas(linhas)

  const incompletas = linhas
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => !pecaCompleta(l))
    .map(({ l, i }) => {
      const faltando = [!l.modelo && 'modelo', !l.cor && 'cor', !(l.total ?? 0) && 'quantidade'].filter(Boolean)
      return `peça ${i + 1} sem ${faltando.join(' e ')}`
    })
  if (incompletas.length > 0) return { pronto: false, falta: incompletas.join('; '), divergencias }
  if (!data.nome || !data.telefone) return { pronto: false, falta: 'contato do cliente incompleto', divergencias }

  return { pronto: true, pecas: linhas, divergencias }
}

/** Manda o resumo do pedido em PDF pro WhatsApp do cliente conferir. */
/**
 * Manda o resumo em PDF pro cliente — uma vez por versão do pedido.
 *
 * A trava é sobre o DOCUMENTO, não sobre o tempo: se o resumo já foi enviado
 * depois da última alteração do pedido, o PDF que o cliente tem na mão é este
 * mesmo, e reenviar só polui a conversa. Se o pedido mudou desde o envio, o
 * documento é outro e vai de novo.
 *
 * Em 09/09/2026 o Julio recebeu o mesmo PDF três vezes em três minutos: ele
 * respondeu "claro", "toop" e "correto", cada uma virou uma rodada do Luigi, e
 * em todas ele achou que devia mandar o resumo. A trava de resposta velha do
 * Luigi chegou tarde demais — ela descarta o TEXTO, mas a ferramenta já tinha
 * rodado e o arquivo já tinha saído. Efeito de ferramenta se trava na
 * ferramenta.
 */
export async function enviarResumoParaCliente(
  pedidoId: string,
  opts: { forcar?: boolean } = {}
): Promise<{ ok: boolean; erro?: string; jaEnviado?: boolean }> {
  const { data: p } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('nome, telefone, atualizado_em, resumo_enviado_em')
    .eq('id', pedidoId)
    .maybeSingle<{ nome: string | null; telefone: string | null; atualizado_em: string | null; resumo_enviado_em: string | null }>()
  if (!p?.telefone) return { ok: false, erro: 'pedido sem telefone do cliente' }

  if (!opts.forcar && p.resumo_enviado_em) {
    const enviado = new Date(p.resumo_enviado_em).getTime()
    const mudou = p.atualizado_em ? new Date(p.atualizado_em).getTime() > enviado : false
    if (!mudou) {
      const hora = new Date(p.resumo_enviado_em).toLocaleTimeString('pt-BR', {
        timeZone: 'America/Recife',
        hour: '2-digit',
        minute: '2-digit',
      })
      return {
        ok: true,
        jaEnviado: true,
        erro: `o resumo já foi enviado às ${hora} e o pedido não mudou desde então — não mande de novo, fale com o cliente sobre o que ele já recebeu`,
      }
    }
  }

  const r = await enviarResumoPdfPedido({
    pedidoId,
    destinos: [
      {
        telefone: p.telefone,
        nome: p.nome,
        legenda: 'Resumo do seu pedido. Confere se está tudo certo e me diz se quer ajustar alguma coisa.',
      },
    ],
  })
  if (r.enviados === 0) return { ok: false, erro: 'não foi possível enviar o PDF agora' }

  // Gravado só depois do envio confirmado: marcar antes deixaria o cliente sem
  // PDF nenhum se a entrega falhasse.
  await supabaseAdmin
    .from('pedidos_assistente')
    .update({ resumo_enviado_em: new Date().toISOString() })
    .eq('id', pedidoId)
  return { ok: true }
}

/**
 * Libera o pedido pros fornecedores — mesmo efeito do botão "Buscar fornecedor"
 * do visualizador: marca confirmado e o pedido entra em buscando_fornecedor.
 *
 * Não reenvia o e-mail de "pedido recebido" quando já havia sido confirmado
 * antes, pela mesma razão da rota /confirmar: reconfirmar não é pedido novo.
 */
export async function liberarParaFornecedores(
  pedidoId: string,
  opts: { ignorarDivergencias?: boolean } = {}
): Promise<{ ok: boolean; erro?: string; jaEstava?: boolean; divergencias?: Divergencia[] }> {
  const conferido = await conferirPedido(pedidoId)
  if (!conferido.pronto) return { ok: false, erro: `pedido ainda não está pronto: ${conferido.falta}`, divergencias: conferido.divergencias }

  // Divergência não é erro do cliente — é ambiguidade que a confecção não
  // consegue resolver sozinha. Segura na primeira vez e devolve o que
  // perguntar; se o cliente já foi consultado e mandou seguir assim, o agente
  // chama de novo com ignorarDivergencias.
  if (conferido.divergencias.length > 0 && !opts.ignorarDivergencias) {
    return {
      ok: false,
      erro: 'o pedido tem pontos que a confecção não consegue adivinhar — resolva com o cliente antes de liberar',
      divergencias: conferido.divergencias,
    }
  }

  const { data: p } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('confirmado_em')
    .eq('id', pedidoId)
    .maybeSingle<{ confirmado_em: string | null }>()

  const agora = new Date().toISOString()
  const { error } = await supabaseAdmin
    .from('pedidos_assistente')
    .update({ status: 'confirmado', confirmado_em: p?.confirmado_em ?? agora, atualizado_em: agora })
    .eq('id', pedidoId)

  if (error) return { ok: false, erro: 'não foi possível liberar agora' }
  return { ok: true, jaEstava: Boolean(p?.confirmado_em) }
}
