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
import { buscarEnderecoCep } from './cep'
import { validarCpfCnpj, apenasDigitos } from './cpf-cnpj'
import { garanteContaPorEmail } from './cliente-auth'
import { guardarImagem } from './imagens-pedido-storage'
import { salvarLinhasEditadas, type LinhaEditada } from './pedido-linhas-edicao'
import { enviarResumoPdfPedido } from './whatsapp-notify'
import { CAMPOS_DO_RESUMO, hashDoResumo } from './resumo-hash'
import type { LinhaPedido } from './pedido-assistente-oferta'
import { ehPublicoValido } from './pecas'

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
 * Grava os dados de entrega e contato que o cliente deu na conversa.
 *
 * O pedido nasce com o telefone (é o WhatsApp dele) e mais nada. Sem CEP não
 * dá pra calcular frete, e sem número de casa a transportadora não entrega —
 * por isso o admin tem um botão "Lançar CEP/endereço", que é trabalho manual
 * pra cada pedido. Em 10/09/2026 os dois pedidos mais novos estavam sem CEP.
 *
 * O CEP se explica sozinho: com os 8 dígitos, buscarEnderecoCep devolve rua,
 * bairro, cidade e UF. Então a conversa precisa arrancar só três coisas —
 * CEP, número e complemento — em vez de ditar o endereço inteiro.
 *
 * NÃO APAGA O QUE JÁ EXISTE: campo que vier vazio fica como está. O cliente
 * corrige uma coisa sem perder o resto.
 */
export async function salvarDadosDoCliente(params: {
  pedidoId: string
  nome?: string | null
  email?: string | null
  cep?: string | null
  numero?: string | null
  complemento?: string | null
  cpfCnpj?: string | null
}): Promise<{ ok: boolean; erro?: string; endereco?: string; falta?: string[] }> {
  const { data: pedido } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, nome, email, telefone, conta_id, cep, logradouro, numero, complemento, bairro, cidade, uf, cpf_cnpj')
    .eq('id', params.pedidoId)
    .maybeSingle<Record<string, string | null>>()
  if (!pedido) return { ok: false, erro: 'pedido não encontrado' }

  const limpo = (v: string | null | undefined) => {
    const t = (v ?? '').trim()
    return t.length > 0 ? t : null
  }
  const patch: Record<string, string | null> = {}
  if (limpo(params.nome)) patch.nome = limpo(params.nome)
  if (limpo(params.email)) patch.email = limpo(params.email)!.toLowerCase()
  if (limpo(params.numero)) patch.numero = limpo(params.numero)
  if (limpo(params.complemento)) patch.complemento = limpo(params.complemento)
  // CPF OU CNPJ — tanto faz qual, mas tem que ser um de verdade.
  //
  // Mesma postura do CEP logo abaixo: número que não fecha o dígito verificador
  // NÃO vira campo preenchido, volta como erro pro Luigi confirmar. Gravar o que
  // veio errado é pior que não gravar — o pedido passa pela trava de liberar
  // parecendo completo e o erro só aparece na emissão da nota, com o cliente já
  // esperando. E CPF ditado no WhatsApp erra: vem por áudio transcrito, com
  // dígito trocado ou faltando.
  const doc = limpo(params.cpfCnpj)
  if (doc) {
    const v = validarCpfCnpj(apenasDigitos(doc))
    if (!v.valido) return { ok: false, erro: `${v.erro ?? 'documento inválido'} — confirme o número com ele` }
    patch.cpf_cnpj = apenasDigitos(doc)
  }

  // CEP só entra se tiver 8 dígitos, e traz o resto do endereço junto. CEP
  // inválido não vira campo vazio: volta como erro, pra ele perguntar de novo.
  const cepDigitos = (params.cep ?? '').replace(/\D/g, '')
  if (params.cep != null && params.cep !== '') {
    if (cepDigitos.length !== 8) return { ok: false, erro: 'esse CEP não tem 8 dígitos — confirme com ele' }
    const end = await buscarEnderecoCep(cepDigitos)
    if (!end) return { ok: false, erro: `não achei o CEP ${cepDigitos} — confirme o número com ele` }
    patch.cep = cepDigitos
    patch.logradouro = end.logradouro
    patch.bairro = end.bairro
    patch.cidade = end.cidade
    patch.uf = end.uf
  }

  if (Object.keys(patch).length === 0) return { ok: false, erro: 'nada pra gravar' }

  const { error } = await supabaseAdmin
    .from('pedidos_assistente')
    .update({ ...patch, atualizado_em: new Date().toISOString() })
    .eq('id', params.pedidoId)
  if (error) return { ok: false, erro: error.message }

  // O MESMO DADO VAI PRO CADASTRO DO CLIENTE — 10/09/2026.
  //
  // Sem isto, cada pedido recomeça do zero: a pessoa dita o endereço de novo, e
  // a Confeccione não sabe que já falou com ela. O e-mail é a chave (é por ele
  // que o cliente entra no painel), então a conta só nasce quando ele aparece.
  //
  // Criar a conta não compromete ninguém: o login é por e-mail e ela só existe
  // pra guardar o que a pessoa já nos deu. O ganho é o próximo pedido nascer com
  // endereço pronto e ela conseguir acompanhar o que pediu.
  //
  // Falhar aqui NÃO derruba o pedido: os dados do pedido já estão salvos, que é
  // o que trava o frete. O cadastro é o extra.
  const emailConta = patch.email ?? pedido.email
  if (emailConta) {
    try {
      const conta = await garanteContaPorEmail(emailConta)
      const doPedido = { ...pedido, ...patch }
      // Só preenche o que a conta ainda não tem: o que a pessoa cadastrou no
      // painel vale mais que o que ela ditou no WhatsApp com pressa.
      const patchConta: Record<string, string | null> = {}
      const talvez = (campo: string, valor: string | null | undefined) => {
        if (valor && !(conta as unknown as Record<string, unknown>)[campo]) patchConta[campo] = valor
      }
      talvez('nome', doPedido.nome)
      talvez('whatsapp', doPedido.telefone)
      talvez('cep', doPedido.cep)
      talvez('logradouro', doPedido.logradouro)
      talvez('numero', doPedido.numero)
      talvez('complemento', doPedido.complemento)
      talvez('bairro', doPedido.bairro)
      talvez('cidade', doPedido.cidade)
      talvez('uf', doPedido.uf)
      if (Object.keys(patchConta).length > 0) {
        await supabaseAdmin
          .from('contas_clientes')
          .update({ ...patchConta, atualizado_em: new Date().toISOString() })
          .eq('id', conta.id)
      }
      // Amarra o pedido à conta pra ele aparecer no painel dela.
      if (!doPedido.conta_id) {
        await supabaseAdmin.from('pedidos_assistente').update({ conta_id: conta.id }).eq('id', params.pedidoId)
      }

      // E AMARRA A CONVERSA À CONTA — 11/09/2026.
      //
      // Faltava o outro lado do vínculo: conta→pedido era escrito aqui e
      // conta→wa_contatos, nunca. O resultado era contato sem `cliente_id`
      // mesmo com conta criada seis minutos antes, no mesmo fluxo — o painel do
      // inbox não tinha como saber quem era a pessoa, e quem foi reclassificada
      // de confecção pra cliente ficava sem identidade nenhuma.
      //
      // É o espelho exato do que o cadastro de fornecedor já fazia
      // (app/api/fornecedor/cadastro/route.ts): casa pelos últimos 8 dígitos,
      // porque o nono dígito faz o mesmo número aparecer de duas formas, e só
      // preenche quem está com o campo NULO — conversa já vinculada a outra
      // conta não é sobrescrita por um pedido.
      //
      // Roda uma vez, no fechamento, não a cada mensagem. E erro aqui só loga:
      // está dentro do mesmo try que já protege o pedido salvo.
      const fim8 = (doPedido.telefone ?? '').replace(/\D/g, '').slice(-8)
      if (fim8.length === 8) {
        const { error: erroVinculo } = await supabaseAdmin
          .from('wa_contatos')
          .update({ cliente_id: conta.id, atualizado_em: new Date().toISOString() })
          .ilike('wa_id', `%${fim8}`)
          .is('cliente_id', null)
        if (erroVinculo) console.error('[pedido-fechamento] vínculo wa_contatos falhou:', erroVinculo.message)
      }
    } catch (err) {
      console.error('[pedido-fechamento] cadastro do cliente falhou (pedido segue salvo):', err)
    }
  }

  const fim = { ...pedido, ...patch }
  // Mesma lista que trava o liberar em conferirPedido. Aqui ela volta a cada
  // gravação pro Luigi saber o que ainda falta pedir, em vez de descobrir só
  // quando tentar liberar e levar a recusa.
  const falta = [
    !fim.email ? 'e-mail' : null,
    !fim.cep ? 'CEP' : null,
    !fim.numero ? 'número' : null,
    !fim.cpf_cnpj ? 'CNPJ (ou CPF, se for no nome dele — ofereça os dois juntos)' : null,
  ].filter((x): x is string => x !== null)

  const endereco = fim.cep
    ? [fim.logradouro, fim.numero, fim.complemento, fim.bairro, [fim.cidade, fim.uf].filter(Boolean).join('/')]
        .filter(Boolean)
        .join(', ')
    : undefined

  return { ok: true, endereco, falta }
}

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
}): Promise<{ ok: boolean; erro?: string; modelo?: string; totalFotos?: number; jaEstava?: boolean }> {
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
  const l = linhas[i]
  const nome = [l?.modelo, l?.cor].filter(Boolean).join(' ') || `modelo ${params.posicao}`
  // FOTO QUE JÁ ESTÁ NO MODELO NÃO ESCREVE NADA — 24/09/2026.
  //
  // Mesma foto duas vezes acontece quando o cliente reenvia — e quando o
  // Luigi re-anexa por conta própria, o que ele faz em quase todo turno de
  // fechamento. Antes o dedupe segurava a duplicata na lista mas o UPDATE
  // rodava assim mesmo, com `atualizado_em` novo. Era esse carimbo que fazia
  // `enviarResumoParaCliente` ler "o pedido mudou" e mandar o PDF de novo: o
  // Miguel (20260900317, 20/09 01:32) recebeu três resumos idênticos em quatro
  // minutos, um por turno, cada um precedido de um re-anexo da mesma foto.
  // Nada mudou, então nada é gravado — e a data de atualização passa a dizer
  // a verdade.
  if (fotos.includes(ref) && !atual.liso && !atual.arte) {
    return { ok: true, modelo: nome, totalFotos: fotos.length, jaEstava: true }
  }
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

  return { ok: true, modelo: nome, totalFotos: fotos.length, jaEstava: false }
}

/**
 * Até quando um pedido aberto pelo Luigi ainda é "o que você acabou de abrir"
 * (ver `criarPedidoParaContato`). Seis horas cobre a sessão de conversa em que
 * o esquecimento acontece (medido: 1, 2 e 6 minutos); dias depois a pergunta
 * "é novo ou mudança?" volta a fazer sentido, porque o cliente também esqueceu.
 */
const MINUTOS_PEDIDO_RECEM_ABERTO = 6 * 60

/** Teto do silêncio: nem o cliente que diz "ano que vem" some pra sempre. */
const MAX_DIAS_PAUSA = 120
/** Quando ele pede tempo sem dizer quanto. Um mês é o "depois" mais comum. */
const DIAS_PAUSA_PADRAO = 30

/**
 * Silencia os lembretes deste pedido até uma data, sem perder o pedido.
 *
 * POR QUE ISTO EXISTE — 10/09/2026
 * A régua de pedido incompleto cobra em 15 min, 24h e 48h. Pra quem está
 * decidindo agora, isso é atendimento. Pra quem disse "vou ver com meu sócio" ou
 * "só mês que vem", é a mesma empresa cutucando três vezes em dois dias — e o
 * cliente não separa a régua do Luigi: quem está sendo chato somos nós.
 *
 * Pausa em vez de encerrar porque o pedido é trabalho dele: peça, cor, grade,
 * às vezes uma hora de conversa. Jogar isso fora pra "limpar o funil" faz o
 * cliente recomeçar do zero quando voltar, e recomeçar do zero é onde ele
 * desiste.
 *
 * A data é o que ELE disse. Sem data, 30 dias — e nunca mais que 120, porque
 * silêncio eterno também é abandono, só que com cara de educação.
 */
export async function pausarLembretesDoPedido(params: {
  pedidoId: string
  /** O que ele falou, nas palavras dele. Vira a justificativa no admin. */
  motivo: string
  /** Quantos dias de silêncio. Sem isto, 30. */
  dias?: number | null
}): Promise<{ ok: boolean; erro?: string; ate?: string; dias?: number }> {
  const pedidos = Math.round(params.dias ?? DIAS_PAUSA_PADRAO)
  const dias = Math.min(MAX_DIAS_PAUSA, Math.max(1, Number.isFinite(pedidos) ? pedidos : DIAS_PAUSA_PADRAO))
  const ate = new Date(Date.now() + dias * 24 * 60 * 60 * 1000)

  const { error } = await supabaseAdmin
    .from('pedidos_assistente')
    .update({
      lembretes_pausados_em: new Date().toISOString(),
      lembretes_pausados_ate: ate.toISOString(),
      lembretes_pausados_motivo: params.motivo.slice(0, 300),
    })
    .eq('id', params.pedidoId)
  if (error) return { ok: false, erro: error.message }

  return { ok: true, ate: ate.toISOString(), dias }
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
/** [dd/mm hh:mm] em Recife — o formato de nota interna que o PDF filtra. */
function carimboRecife(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Recife', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(d).replace(',', '')
}

export async function criarPedidoParaContato(params: {
  telefone: string
  nome?: string | null
  pecas: PecaEntrada[]
  prazoDias?: number | null
  observacoes?: string | null
  /**
   * Código do pedido aberto do qual ESTE é separado — a resposta do cliente à
   * pergunta "é pedido novo ou mudança naquele?".
   *
   * O CLIENTE É QUEM SABE — 16/09/2026. A trava de duplicata recusava e mandava
   * chamar_humano, como se "segundo pedido" fosse decisão nossa. Não é: só ele
   * sabe se as 60 camisetas são outra compra ou a mesma com número novo. A
   * pergunta vai pra ele, e a resposta dele vira DADO aqui — mesmo padrão do
   * `confirmado_pelo_cliente` nas linhas, pelo mesmo motivo: resposta que não
   * escreve em campo nenhum faz a pergunta voltar pra sempre.
   */
  separadoDoPedido?: string | null
}): Promise<{
  ok: boolean
  erro?: string
  pedidoId?: string
  codigo?: string
  resumo?: string
  reaproveitado?: boolean
  /** O aberto é um que o Luigi mesmo abriu há pouco nesta conversa — siga com ele, não pergunte. */
  recemAbertoPeloLuigi?: boolean
}> {
  const tel = params.telefone.replace(/\D/g, '')
  if (tel.length < 10) return { ok: false, erro: 'telefone do contato inválido' }
  if (params.pecas.length === 0) return { ok: false, erro: 'informe ao menos uma peça' }

  // ═══════════════════════════════════════════════════════════════════════
  // UM PEDIDO ABERTO POR PESSOA — 12/09/2026.
  //
  // A versão anterior desta trava era "mesmo telefone + origem whatsapp_luigi +
  // últimos 15 minutos". Medido em produção: ela pegaria ZERO dos 23 pedidos
  // duplicados da base. As duas condições se anulavam —
  //   • a janela de 15 min pegaria 8 dos 23 (a média entre duplicatas é 4.120
  //     minutos; a Clau teve três pedidos idênticos em 35, 66 e 101 minutos);
  //   • e o `origem = 'whatsapp_luigi'` derrubava até esses, porque só 3 dos
  //     pedidos anteriores tinham vindo por esse caminho — o cliente começa no
  //     site e continua no WhatsApp.
  //
  // O QUE A MEDIÇÃO MOSTROU, e muda a forma da trava: de 48 pares do mesmo
  // contato em 48 h, 46 têm LINHAS DIFERENTES. Não é cópia — é o mesmo pedido
  // sendo refinado, e cada refinamento virando pedido novo:
  //   Maira  104 (sem modelo) → 105 (sem modelo) → 106 (corta-vento + legging)
  //   Alefe  061 (calça + colete refletivo) → 064 (sem modelo) → 065 (calça + colete)
  //   Lucas  258 (sem modelo, 0 pç) → 259 (Oversized, 2 pç)
  // Trava por CONTEÚDO pegaria 2 de 48. Por CONTATO pega os 23.
  //
  // Então: existe pedido ABERTO desta pessoa? Devolve ele, com as linhas, e
  // manda ajustar.
  //
  // CONFIRMADO NÃO É HISTÓRIA — 16/09/2026.
  //
  // "Aberto" era `confirmado_em IS NULL`, e isso abriu um buraco no dia em que a
  // liberação virou efeito de código. Caso da Clau, 15/09 15:27:37: o código
  // gravou `confirmado_em` no pedido 20260900295 e SETE SEGUNDOS depois, no mesmo
  // turno, o modelo chamou criar_pedido — a trava consultou, não achou pedido
  // "aberto" (acabara de confirmar o único) e deixou nascer o 20260900310. O
  // Luigi chegou a DIZER "vi que você já tem um pedido completo com essas mesmas
  // camisetas" e criou assim mesmo. Dois minutos depois liberou o duplicado.
  //
  // Pedido confirmado em buscando_fornecedor é o MAIS aberto que existe: está na
  // rua, sendo ofertado. O que encerra a vida dele é `encerrado_em`, ou ter sido
  // pago/finalizado — aí sim a pessoa tem direito a um segundo pedido.
  //
  // SEM JANELA DE TEMPO de propósito: "há quanto tempo" nunca foi a pergunta.
  // A pergunta é se ela já tem um pedido em aberto, e isso não caduca.
  const tel8 = tel.slice(-8)
  const { data: aberto, error: eAberto } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, codigo, linhas, criado_em, origem')
    .like('telefone', `%${tel8}`)
    .is('encerrado_em', null)
    .is('finalizado_em', null)
    .neq('status', 'cancelado')
    // `.neq('pagamento_status','pago')` NÃO serve: `pagamento_status` é NULL em
    // 234 dos 242 pedidos, e `NULL <> 'pago'` é NULL — o filtro excluiria quase
    // toda a base e a trava voltaria a deixar criar duplicata, com o conserto
    // virando o bug. É a armadilha do NULL que o AGENTS.md já nomeia.
    .or('pagamento_status.is.null,pagamento_status.neq.pago')
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; codigo: string | null; linhas: unknown; criado_em: string; origem: string | null }>()
  // Consulta que falha não é "não tem aberto": seria a trava sumindo em silêncio.
  if (eAberto) return { ok: false, erro: `não consegui conferir os pedidos abertos (${eAberto.message}); tente de novo` }
  // O cliente respondeu que é pedido NOVO: confere e deixa passar.
  //
  // Confere de verdade — o código tem que ser de um pedido ABERTO DESTE contato.
  // Sem isso o campo vira senha: qualquer string liberaria a criação, e a trava
  // que custou 23 duplicatas viraria enfeite.
  const separado = (params.separadoDoPedido ?? '').trim()
  let liberadoPeloCliente: string | null = null
  if (separado && aberto) {
    const bate = separado === aberto.codigo || separado === aberto.id
    if (!bate) {
      return {
        ok: false,
        erro:
          `"${separado}" não é o pedido aberto desta pessoa (o aberto é ${aberto.codigo ?? aberto.id}). ` +
          `Se ele disse que é um pedido novo, separado daquele, repita o código certo em separado_do_pedido.`,
      }
    }
    liberadoPeloCliente = aberto.codigo ?? aberto.id
  }

  if (aberto && !liberadoPeloCliente) {
    // Devolve AS LINHAS junto: sem elas o Luigi não sabe o que já está lá e
    // pergunta tudo de novo, que é o comportamento que fez a Ana Vitória
    // repetir a mesma correção três vezes.
    const linhas = Array.isArray(aberto.linhas) ? (aberto.linhas as PecaEntrada[]) : []
    const resumoAtual = linhas
      .map((l, i) => `${i + 1}. ${[l.modelo, l.cor, l.quantidade ? `${l.quantidade} un` : null].filter(Boolean).join(', ')}`)
      .join(' | ')
    const ref = aberto.codigo ?? aberto.id

    // O ABERTO É O QUE O PRÓPRIO LUIGI ACABOU DE ABRIR — 24/09/2026.
    //
    // Das 3 recusas desta trava desde 12/09, as 3 eram um pedido que o Luigi
    // mesmo tinha aberto minutos antes, na mesma conversa (Miguel 317 aos 6
    // min; Kaiky 328 a 1 e a 2 min). O resultado da ferramenta não sobrevive
    // ao turno, então no turno seguinte ele não lembra que criou — e a
    // pergunta genérica "é pedido novo ou mudança?" cai num cliente que
    // descreveu UMA peça e nunca ouviu falar de outro pedido. O Kaiky
    // respondeu "é a primeira vez que peço esse colete", pediu pra "cancelar
    // e abrir um novo", e daí nasceram 330, 331 e 333.
    //
    // Pedido que o Luigi abriu há pouco NESTA conversa não é dúvida: é o
    // pedido dele. A instrução muda de "pergunte" pra "siga com ele".
    const minutos = (Date.now() - new Date(aberto.criado_em).getTime()) / 60_000
    if (aberto.origem === 'whatsapp_luigi' && minutos < MINUTOS_PEDIDO_RECEM_ABERTO) {
      const ha = minutos < 1 ? 'menos de 1 minuto' : `${Math.round(minutos)} min`
      return {
        ok: true,
        reaproveitado: true,
        recemAbertoPeloLuigi: true,
        pedidoId: aberto.id,
        codigo: aberto.codigo ?? undefined,
        erro:
          `o pedido ${ref} foi aberto por VOCÊ nesta conversa há ${ha}, com: ${resumoAtual || '(nenhuma peça ainda)'}. ` +
          `Ele JÁ É o pedido dele — não é outro, e não é dúvida: NÃO crie outro, NÃO pergunte se é novo ou mudança, ` +
          `NÃO encerre pra "abrir um novo". Se ele pediu pra cancelar e abrir novo antes disso, já foi feito e este é o novo. ` +
          `Siga com o ${ref}: ajustar_peca_pedido pra mudar peça, salvar_dados_do_cliente pros dados, anexar_foto_ao_modelo, ` +
          `enviar_resumo_pedido quando estiver inteiro. Só existe segundo pedido se ELE disser, por conta própria, que quer um ` +
          `separado — aí criar_pedido com separado_do_pedido: "${ref}".`,
      }
    }

    return {
      ok: true,
      reaproveitado: true,
      pedidoId: aberto.id,
      codigo: aberto.codigo ?? undefined,
      erro:
        `existe o pedido ${aberto.codigo ?? aberto.id} aberto, com: ${resumoAtual || '(nenhuma peça ainda)'}. ` +
        `NÃO crie outro por conta própria. ` +
        `PERGUNTE AO CLIENTE, numa frase: é um pedido NOVO, separado do ${aberto.codigo ?? aberto.id}, ou é mudança nesse? ` +
        `Se ele disser que é novo, chame criar_pedido de novo com separado_do_pedido: "${aberto.codigo ?? aberto.id}". ` +
        `Se disser que é mudança, use ajustar_peca_pedido (ou definir_pecas_pedido pra trocar a lista inteira).`,
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
      // A resposta do cliente vira DADO, não some no ar: daqui a um mês dá pra
      // saber que este segundo pedido foi escolha dele, e não a trava falhando.
      // Formato [dd/mm hh:mm] é o que o resumo-pdf.ts filtra pra não vazar nota
      // interna pra confecção.
      observacoes: liberadoPeloCliente
        ? [params.observacoes, `[${carimboRecife()}] segundo pedido, separado do ${liberadoPeloCliente}, a pedido do cliente`]
            .filter(Boolean)
            .join('\n')
        : params.observacoes ?? null,
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

// A lista mora em pecas.ts — ver o comentário de lá sobre cópia divergente.

/**
 * Palavra que AMARRA a segunda cor à peça — sinal de bicolor, não de duas peças.
 *
 * "branca COM COSTURA preta", "LISTRADO azul e branco", "FRENTE branca /
 * TRASEIRA azul": em todos, a segunda cor tem um lugar na peça. Quando a cor é
 * só um par solto ("Branca e azul marinho"), ninguém disse onde cada uma fica —
 * e aí a pergunta ao cliente faz sentido.
 *
 * `\b` não serve: em JS ele é ASCII e falha depois de acento no fim da palavra
 * (foi o que deixou "boné" escapar de uma lista parecida em pecas.ts). Guardas
 * unicode.
 */
const CONECTOR_BICOLOR =
  /(?<!\p{L})(com|costuras?|detalhes?|listrad\w*|listras?|frente|traseira|externa?|interna?|al[çc]a|bico|gola|punhos?|barra|extremidades?|capa|estampa\w*|vivo|frisos?|manga)(?!\p{L})/iu

/**
 * O mesmo conector, pra DESCRIÇÃO — 25/09/2026. A descrição fala de arte, e
 * arte tem vocabulário próprio: "estampa", "sublimação", "logo", "fundo",
 * "texto em laranja", "degradê", "halftone". Qualquer um deles LOGO ANTES de
 * um par de cores diz que as cores são da mesma peça. Ver `coresSoltas`.
 */
const CONECTOR_NA_DESCRICAO =
  /(?<!\p{L})(com|costuras?|detalhes?|listrad\w*|listras?|frente|costas|traseira|externa?|interna?|al[çc]as?|bico|gola|punhos?|barra|extremidades?|capa|estampa\w*|sublima\w*|logo\w*|logotipo|artes?|aplica\w*|bordad\w*|silk|dtf|serigrafia|impress\w*|print|fundo|texto|escrit[ao]s?|letras?|desenho|imagem|degrad\w*|halftone|veludo|forro|faixas?|bordas?|vi[eé]s|vivo|frisos?|mangas?|sobre|efeito|refer[êe]ncia|bicolor|tricolor|mesclad\w*|ringer|corpo)(?!\p{L})/iu

/** As cores que a regra 2 reconhece, com plural — "10 azuis e 5 brancas" tem as duas no plural. */
const COR = 'azu(?:l|is)|branc[ao]s?|pret[ao]s?|verdes?|vermelh[ao]s?|amarel[ao]s?|cinzas?|rosas?'
const COR_SOLTA = new RegExp(`(?<!\\p{L})(${COR})(?!\\p{L})`, 'giu')
/** "azul e branca", "preto/branco", "azul, vermelha" — duas cores coladas. */
const PAR_DE_CORES = new RegExp(`(?<!\\p{L})(${COR})\\s*(?:e|ou|,|/|\\+)\\s*(${COR})(?!\\p{L})`, 'giu')

/** "azuis" e "azul" são a mesma cor; "verde" e "vermelho" não (e as duas começam com "ver"). */
function corCanonica(palavra: string): string {
  const p = palavra.toLowerCase()
  if (p.startsWith('azu')) return 'azul'
  if (p.startsWith('branc')) return 'branco'
  if (p.startsWith('pret')) return 'preto'
  if (p.startsWith('verd')) return 'verde'
  if (p.startsWith('vermelh')) return 'vermelho'
  if (p.startsWith('amarel')) return 'amarelo'
  if (p.startsWith('cinz')) return 'cinza'
  return 'rosa'
}

/**
 * Número colado numa cor: "10 azuis e 5 brancas", "3 peças pretas". É o
 * sinal inequívoco de quantidade por cor dentro do texto — acusa mesmo que a
 * descrição esteja cheia de conector.
 */
const QUANTIDADE_POR_COR = new RegExp(
  `(?<!\\p{L})\\d+\\s+(?:pe[çc]as?\\s+|unidades?\\s+|un\\.?\\s+|camisetas?\\s+|camisas?\\s+|polos?\\s+|blusas?\\s+|cal[çc]as?\\s+|regatas?\\s+|shorts?\\s+|bermudas?\\s+)?(?:${COR})(?!\\p{L})`,
  'iu'
)

/**
 * Par de cores coladas SEM nada que as amarre à peça: "Camisetas azul e
 * branca para o time". O que amarra é o que vem logo antes — "em preto e
 * branco", "estampa azul e vermelha", "detalhe preto/branco" — ou a palavra
 * logo depois que diz que é padrão da mesma peça ("preto/branco listrado").
 */
function coresSoltas(desc: string): boolean {
  for (const m of desc.matchAll(PAR_DE_CORES)) {
    if (corCanonica(m[1]) === corCanonica(m[2])) continue
    const inicio = m.index ?? 0
    const antes = desc.slice(Math.max(0, inicio - 30), inicio)
    const depois = desc.slice(inicio + m[0].length, inicio + m[0].length + 14)
    if (CONECTOR_NA_DESCRICAO.test(antes)) continue
    if (/(?:^|[^\p{L}])(?:em|de|do|da|com)\s*$/iu.test(antes)) continue
    if (/^\s*(?:listrad|mesclad|bicolor|degrad|xadrez)/iu.test(depois)) continue
    return true
  }
  return false
}

export function revisarPecas(linhas: LinhaPedido[]): Divergencia[] {
  const achados: Divergencia[] = []

  linhas.forEach((l, i) => {
    const posicao = i + 1
    const cor = (l.cor ?? '').trim()
    const desc = (l.descricao ?? '').trim()
    const publico = ((l as { publico?: string | null }).publico ?? '').trim().toLowerCase()
    // DIVERGÊNCIA QUE O CLIENTE JÁ RESPONDEU PARA DE SER DIVERGÊNCIA — 12/09/2026.
    //
    // Antes disto a revisão era regra sobre TEXTO, e a resposta do cliente não
    // escrevia em campo nenhum: pergunta → resposta → mesma recusa → mesma
    // pergunta. No 20260900305 ele respondeu TRÊS vezes ("uma polo só com duas
    // cores" 21:11, "correto" 22:00, "pode liberar o pedido" 22:33) e a
    // liberação foi recusada as três. Loop por construção.
    //
    // Em 30 dias, `liberar_para_fornecedores` recusou 9 de 15 vezes e 100% das
    // recusas foram divergência, em 8 pedidos.
    //
    // ISENTA SÓ AS REGRAS 1 E 2, SÓ NESTA LINHA. Não é passe livre pela revisão:
    // confirmar que a peça é bicolor não pode fazer o público sumir sem ninguém
    // reparar, e a checagem de público está logo abaixo, no mesmo forEach.
    //
    // Não existe trava garantindo que ele perguntou antes de preencher — não dá
    // pra fazer isso sem voltar a regex sobre frase, que é o que acabou de
    // falhar. O campo é auditável de propósito: quem pega abuso é a contagem.
    const confirmado = ((l as { confirmado_pelo_cliente?: string | null }).confirmado_pelo_cliente ?? '').trim()

    // ==================================================================
    // DUAS CORES, OU UMA PEÇA BICOLOR? — 12/09/2026.
    //
    // A regra acusava qualquer separador em `cor` ("branca e azul marinho",
    // "preto/branco"). Medido nas 534 linhas de produção: 18 acusações, e
    // classificando à mão uma por uma, 13 eram PEÇA BICOLOR — uma peça só, dois
    // tons nela. O caso que não deixa dúvida é o 20260600010 m1/m2, cuja
    // `descricao` diz literalmente "bicolor, sublimação total": a trava mandava
    // separar uma peça que o cliente já tinha descrito como bicolor. As duas
    // linhas ali diferem por `publico` (masculino / baby look), não por cor.
    //
    // O custo do falso positivo não é só ruído: `liberarParaFornecedores` para
    // quando há divergência, e o Luigi devolve `pronto_para_liberar: false` com
    // "resolva as divergências antes de seguir". O 20260900292 tomou duas
    // acusações no dia em que nasceu e precisou ser liberado na mão.
    //
    // CASO DE TESTE — NÃO REMOVA ESTA TRAVA ACHANDO QUE ELA NUNCA ACERTA.
    // `pedidos_assistente_edicoes`, 09/09/2026 17:10, autor admin:
    //     antes:  tshirt — "Branca e azul marinho"
    //     depois: "Azul marinho", "Branca"
    // Verdadeiro positivo confirmado: duas cores que viraram duas linhas. Note
    // que ele NÃO tem palavra de conector, então a regra abaixo o preserva.
    //
    // ESTA CORREÇÃO É PARCIAL, E DE PROPÓSITO.
    // Ela tira os 13 fáceis (72%) e deixa 3 falsos positivos de pé:
    // "azul marinho/branco" (×2) e "marinho/branco". Não é descuido — é que a
    // informação que separa de verdade NÃO ESTÁ NO CAMPO `cor`. Está na
    // `descricao` ("bicolor", "listrado", "sublimação total") e na estrutura da
    // linha (uma grade de tamanhos contra duas). Regex sobre `cor` não alcança
    // isso, e forçar daria 3 falsos positivos pra 1 verdadeiro — proporção que
    // treina o agente a ignorar o aviso, que é pior que não ter aviso.
    // A separação de verdade está nomeada como trabalho da Fase 2.
    // ==================================================================
    if (!confirmado && /\s+e\s+|\s*\/\s*|\s*,\s*|\s*\+\s*/.test(cor) && cor.length > 3 && !CONECTOR_BICOLOR.test(cor)) {
      achados.push({
        posicao,
        o_que: `a peça ${posicao} tem mais de uma cor no mesmo item ("${cor}") — a confecção precisa de uma linha por cor pra orçar`,
        pergunte: `confirmar quantas peças de cada cor e separar em modelos diferentes`,
      })
    }

    // A descrição fala de cor ou tamanho que não está nos campos — sinal de que
    // o cliente detalhou no texto o que deveria estar estruturado.
    //
    // CORES NUMA DESCRIÇÃO DE ESTAMPA NÃO SÃO DUAS PEÇAS — 25/09/2026.
    //
    // Até aqui bastava a descrição ter mais de 40 caracteres e duas cores
    // diferentes. Medido nos últimos 30 dias: esta regra recusou 8 liberações,
    // em 3 pedidos, e nos 3 a descrição era UMA peça só: a beca preta com
    // veludo vinho nas mangas e detalhe branco (10/09); a camiseta branca com
    // estampa em preto, laranja e amarelo (Madu, 25/09); a regata off white com
    // "USJ" em verde nas costas (gabi, 24/09). Zero verdadeiros. O custo de cada
    // falso positivo é o loop que o Fernando vê da cadeira dele: a cliente diz
    // "sim" à pergunta de fechamento, a liberação bate aqui, o Luigi pergunta
    // de novo — duas vezes com a Madu — e a gabi nunca respondeu à segunda.
    //
    // O que a regra queria pegar é quantidade POR COR escondida no texto: "10
    // azuis e 5 brancas". Então agora ela só acusa nesses dois casos: há número
    // colado numa cor, ou um par de cores coladas sem NADA que as amarre à
    // peça logo antes ("Camisetas azul e branca para o time") — o mesmo
    // raciocínio do CONECTOR_BICOLOR da regra 1, estendido ao vocabulário de
    // descrição de arte e olhado LOCALMENTE, ao redor do par. A regra antiga
    // também não via plural: "10 azuis e 5 brancas", o caso que ela queria,
    // passava em branco enquanto "rosto em preto e branco" era barrado.
    if (!confirmado && desc.length > 40 && cor) {
      const distintas = new Set(Array.from(desc.matchAll(COR_SOLTA), (m) => corCanonica(m[1])))
      if (distintas.size > 1 && (QUANTIDADE_POR_COR.test(desc) || coresSoltas(desc))) {
        achados.push({
          posicao,
          o_que: `a descrição da peça ${posicao} mistura cores diferentes ("${desc.slice(0, 90)}")`,
          pergunte: `qual peça é de qual cor e em que tamanho, pra separar direito`,
        })
      }
    }

    if (!ehPublicoValido(publico)) {
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

/**
 * `pecasCompletas` separa DUAS faltas que pedem reações diferentes.
 *
 * Peça sem cor ou sem quantidade impede tudo: não dá nem pra mostrar o resumo,
 * porque o resumo estaria errado. Já cliente sem CEP ou sem CPF impede LIBERAR,
 * mas não impede conferir — o PDF do que ele pediu está correto e mandar cedo
 * ajuda, porque ele confere as peças enquanto passa os dados.
 *
 * Sem essa distinção, a trava de dados de frete/nota seguraria também o PDF, e
 * a conversa ficaria parada num "me passa o CEP" sem o cliente ter visto nada.
 */
export type ProntoParaLiberar =
  | { pronto: true; pecas: LinhaPedido[]; divergencias: Divergencia[]; pecasCompletas: true }
  | { pronto: false; falta: string; divergencias: Divergencia[]; pecasCompletas: boolean }

/**
 * O pedido está em pé pra ir aos fornecedores? Verificação explícita, e não
 * confiança no que o agente acha que preencheu.
 */
export async function conferirPedido(pedidoId: string): Promise<ProntoParaLiberar> {
  const { data } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('linhas, nome, telefone, email, cep, numero, cpf_cnpj, status, pagamento_status')
    .eq('id', pedidoId)
    .maybeSingle<{
      linhas: LinhaPedido[] | null
      nome: string | null
      telefone: string | null
      email: string | null
      cep: string | null
      numero: string | null
      cpf_cnpj: string | null
      status: string | null
      pagamento_status: string | null
    }>()
  if (!data) return { pronto: false, falta: 'pedido não encontrado', divergencias: [], pecasCompletas: false }
  if (data.pagamento_status === 'pago') return { pronto: false, falta: 'pedido já pago', divergencias: [], pecasCompletas: false }
  if (data.status === 'cancelado') return { pronto: false, falta: 'pedido cancelado', divergencias: [], pecasCompletas: false }

  const linhas = Array.isArray(data.linhas) ? data.linhas : []
  if (linhas.length === 0) return { pronto: false, falta: 'nenhuma peça definida', divergencias: [], pecasCompletas: false }

  const divergencias = revisarPecas(linhas)

  const incompletas = linhas
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => !pecaCompleta(l))
    .map(({ l, i }) => {
      const faltando = [!l.modelo && 'modelo', !l.cor && 'cor', !(l.total ?? 0) && 'quantidade'].filter(Boolean)
      return `peça ${i + 1} sem ${faltando.join(' e ')}`
    })
  if (incompletas.length > 0) return { pronto: false, falta: incompletas.join('; '), divergencias, pecasCompletas: false }

  // -------------------------------------------------- dados do cliente
  // NÃO DÁ PRA LIBERAR SEM ISTO — 10/09/2026.
  //
  // Estes quatro campos não são burocracia de cadastro: cada um trava uma
  // etapa que vem DEPOIS, quando o cliente já está esperando.
  //   cep + número → sem endereço completo não sai cotação de frete, e a
  //                  confecção precisa do frete pra fechar preço.
  //   cpf/cnpj     → sem isso não se emite nota fiscal.
  //   e-mail       → é por onde vai o orçamento e a nota.
  //
  // A trava mora AQUI, e não no prompt, de propósito. Prompt é intenção: o
  // Luigi lê "peça o CEP", acha que já pediu, e libera assim mesmo — foi o que
  // aconteceu com a Ias em 09/09, pedido fechado sem e-mail, sem CEP e sem
  // número. Efeito de ferramenta se trava dentro da ferramenta.
  //
  // O texto é escrito pro Luigi ler e repassar: diz o que falta em português,
  // na ordem em que convém perguntar, pra ele voltar pro cliente com UMA
  // pergunta em vez de despejar um formulário.
  const faltaDado = [
    !data.nome?.trim() && 'o nome de quem recebe',
    !data.telefone?.trim() && 'o telefone',
    !data.email?.trim() && 'o e-mail (pra onde vai o orçamento e a nota)',
    !data.cep?.replace(/\D/g, '') && 'o CEP (sem ele não sai cotação de frete)',
    !data.numero?.trim() && 'o número da casa (a transportadora não entrega sem)',
    // CNPJ primeiro, CPF na mesma frase. Perguntar "CPF ou CNPJ?" faz quem não
    // tem empresa sentir que devia ter — e é a maioria dos clientes.
    !data.cpf_cnpj?.replace(/\D/g, '') &&
      'o CNPJ pra nota fiscal — ou o CPF, se a compra for no nome dele (ofereça os dois na mesma frase)',
  ].filter(Boolean) as string[]

  if (faltaDado.length > 0) {
    return {
      pronto: false,
      falta:
        `ainda falta ${faltaDado.join(', ')}. ` +
        'Peça ao cliente UMA coisa por vez, com naturalidade, e grave com salvar_dados_do_cliente ' +
        'a cada resposta. Só libere quando tudo isto estiver preenchido.',
      divergencias,
      pecasCompletas: true,
    }
  }

  return { pronto: true, pecas: linhas, divergencias, pecasCompletas: true }
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
    .select(`telefone, atualizado_em, resumo_enviado_em, resumo_enviado_hash, ${CAMPOS_DO_RESUMO}`)
    .eq('id', pedidoId)
    .maybeSingle<Record<string, unknown> & { telefone: string | null; atualizado_em: string | null; resumo_enviado_em: string | null; resumo_enviado_hash: string | null }>()
  if (!p?.telefone) return { ok: false, erro: 'pedido sem telefone do cliente' }

  const hash = hashDoResumo(p)
  if (!opts.forcar && p.resumo_enviado_em) {
    const enviado = new Date(p.resumo_enviado_em).getTime()
    // Com assinatura gravada, quem decide é o CONTEÚDO. Sem ela (resumo
    // anterior a 24/09), vale a data — é o melhor que aquele registro tem.
    const mudou = p.resumo_enviado_hash
      ? p.resumo_enviado_hash !== hash
      : p.atualizado_em
        ? new Date(p.atualizado_em).getTime() > enviado
        : false
    if (!mudou) {
      const hora = new Date(p.resumo_enviado_em).toLocaleTimeString('pt-BR', {
        timeZone: 'America/Recife',
        hour: '2-digit',
        minute: '2-digit',
      })
      return {
        ok: true,
        jaEnviado: true,
        erro: `o resumo já foi enviado às ${hora} e o que vai no PDF é idêntico ao que ele já recebeu — não mande de novo, fale com o cliente sobre o que ele já tem em mãos`,
      }
    }
  }

  const r = await enviarResumoPdfPedido({
    pedidoId,
    destinos: [
      {
        telefone: p.telefone,
        nome: (p.nome as string | null) ?? null,
        legenda: 'Resumo do seu pedido. Confere se está tudo certo e me diz se quer ajustar alguma coisa.',
      },
    ],
    // Quem mandou foi o Luigi. Sem esta marca a linha entra como nula no inbox,
    // a trava de "gente na conversa" lê isso como pessoa e ele se cala nos 15
    // minutos seguintes ao próprio resumo — bem quando o cliente responde.
    autor: 'luigi',
  })
  if (r.enviados === 0) return { ok: false, erro: 'não foi possível enviar o PDF agora' }
  // QUEM CARIMBA É O ENVIO, NÃO O CHAMADOR — 24/09/2026. `resumo_enviado_em` e
  // a assinatura são gravados dentro de enviarResumoPdfPedido, no momento em
  // que o PDF chega ao CLIENTE — por qualquer caminho. Ver a nota lá.
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
