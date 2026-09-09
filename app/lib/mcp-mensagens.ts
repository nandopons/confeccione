// app/lib/mcp-mensagens.ts
// ============================================================================
// ENVIO DE MENSAGEM PELO MCP, EM DUAS ETAPAS (09/09/2026).
//
// A v1 do servidor MCP não mandava mensagem de propósito: efeito externo é
// irreversível e uma frase mal interpretada chega ao cliente com a marca da
// Confeccione. O que destrava isso não é confiar mais no modelo — é separar
// escrever de enviar:
//
//   prepararMensagem()  grava o texto e devolve um id. Não manda nada.
//   enviarRascunho(id)  manda exatamente aquele texto.
//
// Entre uma coisa e outra o Fernando lê. O que sai é o que ele aprovou, e não
// o que o modelo resolveu reescrever no caminho.
//
// TRAVAS
//   - Rascunho expira em 30 min (conversa anda; janela de 24 h fecha).
//   - Rascunho já enviado não envia de novo — a checagem é no UPDATE, não
//     antes dele, porque duas chamadas simultâneas passariam pelo SELECT.
//   - Fora da janela de 24 h só sai template aprovado. Isso é regra da Meta,
//     não escolha nossa: texto livre fora da janela falha na API.
//   - Não manda pro número do gestor: pauta e aviso de gestão têm caminho
//     próprio (enviar_pauta_gestao) e misturar os dois confunde o inbox.
//
// A mensagem entra no inbox com autor 'mcp', então na bolha dá pra ver que
// quem escreveu foi o assistente pelo Cowork, e não gente nem o Luigi.
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import { enviarTemplate, enviarTexto, normalizarWaId } from './whatsapp-cloud'
import { janela24hAberta, registrarSaidaInbox } from './whatsapp-notify'
import { acharPedido } from './etapas-pedido'
import { consultarTemplatesWhatsApp } from './whatsapp-templates'

/**
 * Números do gestor, lidos da env aqui em vez de importados de gestao-whatsapp.
 * O agente de gestão importa este módulo (pra ganhar preparar/enviar), então
 * importar de volta fecharia um ciclo entre os dois arquivos. Como isto é só
 * leitura de env, duplicar as três linhas sai mais barato que o ciclo.
 */
function numerosDoGestor(): string[] {
  return (process.env.WHATSAPP_GESTAO_NUMEROS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizarWaId)
    .filter((n) => n.replace(/\D/g, '').length >= 10)
}

export type Rascunho = {
  id: string
  waId: string
  nome: string | null
  texto: string
  templateNome: string | null
  janelaAberta: boolean
  expiraEm: string
}

export type ResultadoPreparo =
  | { ok: true; rascunho: Rascunho; aviso: string | null }
  | { ok: false; erro: string }

/**
 * Grava o rascunho e devolve o id. NÃO envia.
 *
 * Quando a janela de 24 h está fechada, texto livre não sai (a Meta recusa) —
 * nesse caso é preciso informar `templateNome` de um template aprovado. O
 * preparo com janela fechada e sem template é recusado aqui, e não lá na
 * frente no envio, pra o erro aparecer enquanto ainda dá pra corrigir.
 */
/**
 * A gente já falou com esse número hoje? E ele respondeu depois disso?
 *
 * Compara pelos 8 últimos dígitos porque o mesmo celular aparece com e sem o
 * nono dígito, e o contato duplicado é justamente onde o disparo repetido
 * passaria batido.
 */
async function ultimaMensagemDoDia(
  waId: string
): Promise<{ hora: string; template: string | null; clienteFalouDepois: boolean } | null> {
  const fim8 = waId.replace(/\D/g, '').slice(-8)
  if (fim8.length < 8) return null

  const { data: contatos } = await supabaseAdmin.from('wa_contatos').select('id, wa_id').ilike('wa_id', `%${fim8}`)
  const ids = ((contatos ?? []) as Array<{ id: string }>).map((c) => c.id)
  if (ids.length === 0) return null

  const { data: convs } = await supabaseAdmin.from('wa_conversas').select('id').in('contato_id', ids)
  const convIds = ((convs ?? []) as Array<{ id: string }>).map((c) => c.id)
  if (convIds.length === 0) return null

  // "Hoje" no fuso de Recife, não no do servidor: às 22h de Recife o servidor
  // em UTC já virou o dia, e a trava sumiria justo no fim da tarde.
  const agora = new Date()
  const emRecife = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Recife' }))
  const inicioDoDia = new Date(agora.getTime() - (emRecife.getHours() * 3600 + emRecife.getMinutes() * 60) * 1000)

  const { data: msgs } = await supabaseAdmin
    .from('wa_mensagens')
    .select('direcao, template_nome, criado_em')
    .in('conversa_id', convIds)
    .gte('criado_em', inicioDoDia.toISOString())
    .order('criado_em', { ascending: false })
    .limit(50)

  const linhas = (msgs ?? []) as Array<{ direcao: string; template_nome: string | null; criado_em: string }>
  const ultimaSaida = linhas.find((m) => m.direcao === 'saida')
  if (!ultimaSaida) return null

  const entradaDepois = linhas.some(
    (m) => m.direcao === 'entrada' && new Date(m.criado_em).getTime() > new Date(ultimaSaida.criado_em).getTime()
  )
  return {
    hora: new Date(ultimaSaida.criado_em).toLocaleTimeString('pt-BR', {
      timeZone: 'America/Recife',
      hour: '2-digit',
      minute: '2-digit',
    }),
    template: ultimaSaida.template_nome,
    clienteFalouDepois: entradaDepois,
  }
}

export async function prepararMensagem(params: {
  telefone: string
  texto: string
  nome?: string | null
  templateNome?: string | null
  templateVariaveis?: string[]
  pedidoId?: string | null
  contexto?: string | null
}): Promise<ResultadoPreparo> {
  const waId = normalizarWaId(params.telefone)
  if (!waId || waId.length < 12) {
    return { ok: false, erro: `Telefone "${params.telefone}" não parece um número válido com DDI e DDD.` }
  }

  if (numerosDoGestor().includes(waId)) {
    return {
      ok: false,
      erro: 'Esse é o número do gestor. Pauta e aviso de gestão vão por enviar_pauta_gestao, não por aqui.',
    }
  }

  const texto = params.texto.trim()
  if (texto.length < 2) return { ok: false, erro: 'Texto vazio.' }

  // Um template com {{1}}, {{2}}… não sai sem os valores: a Meta responde
  // "#132000 Number of parameters does not match". Conferir aqui evita que o
  // erro só apareça no envio, quando quem chamou já acha que está tudo certo.
  if (params.templateNome) {
    const r = await consultarTemplatesWhatsApp([params.templateNome])
    const def = r.ok ? r.templates.find((t) => t.name === params.templateNome) : undefined
    if (r.ok && !def) {
      return { ok: false, erro: `O template "${params.templateNome}" não existe na WABA. Veja os aprovados com templates_whatsapp.` }
    }
    if (def && def.status !== 'APPROVED') {
      return { ok: false, erro: `O template "${params.templateNome}" está ${def.status}, não dá pra usar ainda.` }
    }
    // TEMPLATE DE FORNECEDOR NÃO VAI PRA CLIENTE (09/09/2026)
    // sondagem_producao diz "uma produção COM VOCÊS" e luigi_apresentacao é a
    // abertura fria de confecção. Foram os dois que saíram pra Letícia, Nelson,
    // Bruno, Ramon e Yasmin — clientes com pedido parado, que leram a empresa
    // deles perguntando se eles fabricam. O prompt já avisava; a lista de 60
    // apagou o aviso. Aqui não apaga.
    const SO_PARA_CONFECCAO = new Set(['sondagem_producao', 'luigi_apresentacao', 'oferta_pedido', 'oferta_pedido_v2', 'oferta_pedido_v3', 'oferta_pedido_v4'])
    if (SO_PARA_CONFECCAO.has(params.templateNome) && params.pedidoId) {
      return {
        ok: false,
        erro:
          `"${params.templateNome}" é template de abordagem a CONFECÇÃO ("uma produção com vocês") e você está mandando ` +
          'pra alguém com pedido em aberto, ou seja, um cliente. Pra cliente use duvida_pedido_manha, ' +
          'duvida_pedido_tarde ou duvida_pedido_noite, conforme a hora — eles falam do pedido dele.',
      }
    }

    if (def) {
      const esperadas = new Set((def.corpo ?? '').match(/\{\{\s*\d+\s*\}\}/g)?.map((m) => m.replace(/\D/g, '')) ?? [])
      const recebidas = (params.templateVariaveis ?? []).filter((v) => String(v ?? '').trim()).length
      if (esperadas.size !== recebidas) {
        return {
          ok: false,
          erro:
            `O template "${params.templateNome}" pede ${esperadas.size} variável(is) e você passou ${recebidas}. ` +
            `Corpo: "${def.corpo}". Informe template_variaveis na ordem — pra {{1}} costuma ser o primeiro nome de quem recebe.`,
        }
      }
    }
  }

  // UMA MENSAGEM NOSSA POR DIA, POR PESSOA (09/09/2026)
  //
  // O agente mandou duvida_pedido_tarde pra Letícia e pro Nelson às 14h54, e
  // sondagem_producao pros MESMOS dois às 15h10 — dezesseis minutos depois,
  // sem que eles tivessem respondido nada. Do lado de lá são duas abordagens
  // frias da mesma empresa em quinze minutos: isso é spam, e é assim que a
  // Meta rebaixa a qualidade do número e depois bloqueia o disparo.
  //
  // A regra não pode viver no prompt. Quem está no meio de uma lista de 60
  // perde o fio, e "revisa a conversa antes" é exatamente o tipo de instrução
  // que se apaga sob pressão. Aqui é consulta ao banco: ou passou o dia, ou
  // não sai.
  //
  // A exceção é a pessoa ter escrito depois: se ela respondeu, a conversa é
  // dela e responder de novo é atendimento, não abordagem.
  const ultimo = await ultimaMensagemDoDia(waId)
  if (ultimo && !ultimo.clienteFalouDepois) {
    return {
      ok: false,
      erro:
        `Já mandamos mensagem pra esse número hoje às ${ultimo.hora}` +
        `${ultimo.template ? ` (template ${ultimo.template})` : ''} e ele ainda não respondeu. ` +
        'Duas abordagens no mesmo dia viram spam e derrubam a qualidade do número na Meta. ' +
        'Espere a resposta ou deixe pra amanhã — e siga pra próxima pessoa da lista.',
    }
  }

  const janelaAberta = await janela24hAberta(waId)
  if (!janelaAberta && !params.templateNome) {
    return {
      ok: false,
      erro:
        'A janela de 24 h com esse contato está fechada: a Meta só aceita template aprovado. ' +
        'Consulte templates_whatsapp e prepare de novo informando template_nome.',
    }
  }

  // O agente costuma passar o CÓDIGO do pedido (2026090…), que é como ele
  // aparece em toda tela e em toda conversa — mas a coluna é uuid. Resolver
  // aqui evita o erro de tipo e evita exigir que quem chama saiba a diferença.
  let pedidoId: string | null = null
  // O NOME NÃO PODE SE PERDER NO CAMINHO — 09/09/2026.
  // O agente manda o nome dentro de `template_variaveis` (é o {{1}}) e deixa
  // `nome` vazio. A mensagem sai certa ("Oi, Thierry"), mas o contato entra no
  // inbox sem nome, e a lista de conversas vira uma coluna de telefones — como
  // ficou hoje com o Thierry e o Leonardo. Quem abre o inbox depois não sabe
  // com quem falou.
  //
  // Ordem de preferência: o que veio explícito, depois o nome do pedido (é o
  // cadastro, mais confiável), e por último a primeira variável do template.
  let nome = params.nome?.trim() || null
  if (params.pedidoId) {
    const ref = params.pedidoId.trim()
    const ehUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref)
    const achado = ehUuid ? null : await acharPedido(ref)
    pedidoId = ehUuid ? ref : (achado?.id ?? null)
    if (!pedidoId) {
      return { ok: false, erro: `Pedido "${params.pedidoId}" não encontrado — confira o código, ou deixe o campo vazio.` }
    }
    if (!nome && achado?.nome) nome = achado.nome
  }
  if (!nome) {
    const primeira = params.templateVariaveis?.[0]?.trim()
    // Só se parecer nome: {{1}} de outros templates carrega hora, valor, código.
    if (primeira && primeira.length >= 2 && /^\p{L}[\p{L}\s.'-]{1,60}$/u.test(primeira)) nome = primeira
  }

  const { data, error } = await supabaseAdmin
    .from('mcp_mensagens_rascunho')
    .insert({
      wa_id: waId,
      nome,
      texto,
      template_nome: params.templateNome ?? null,
      template_variaveis: params.templateVariaveis ?? null,
      pedido_id: pedidoId,
      contexto: params.contexto ?? null,
      janela_aberta: janelaAberta,
    })
    .select('id, expira_em')
    .single()

  // Devolver o erro real, e não uma frase genérica: com "não foi possível" o
  // agente fica adivinhando (chutou template errado e número errado em
  // 09/09/2026, e ainda pediu ao Fernando pra abrir painel à toa).
  if (error || !data) {
    console.error('[mcp-mensagens] insert do rascunho falhou', { error })
    return { ok: false, erro: `Não foi possível gravar o rascunho: ${error?.message ?? 'erro desconhecido'}` }
  }

  return {
    ok: true,
    rascunho: {
      id: data.id as string,
      waId,
      nome,
      texto,
      templateNome: params.templateNome ?? null,
      janelaAberta,
      expiraEm: data.expira_em as string,
    },
    aviso: params.templateNome
      ? 'Vai como template: o cliente recebe o texto aprovado na Meta, não este texto — este serve de referência do que você quis dizer.'
      : null,
  }
}

export type ResultadoEnvio =
  | { ok: true; waId: string; texto: string; wamid: string | null }
  | { ok: false; erro: string }

/**
 * Manda o rascunho. A trava anti-duplicata é o `.is('enviado_em', null)` no
 * UPDATE: quem perder a corrida não acha linha e sai sem mandar nada. Marcar
 * antes de enviar é de propósito — em caso de falha o registro fica com erro,
 * o que é melhor do que arriscar mandar duas vezes pro cliente.
 */
export async function enviarRascunho(id: string): Promise<ResultadoEnvio> {
  const { data: r } = await supabaseAdmin
    .from('mcp_mensagens_rascunho')
    .select('id, wa_id, nome, texto, template_nome, template_variaveis, expira_em, enviado_em')
    .eq('id', id)
    .maybeSingle()

  if (!r) return { ok: false, erro: 'Rascunho não encontrado. Prepare de novo com preparar_mensagem.' }
  if (r.enviado_em) return { ok: false, erro: `Esse rascunho já foi enviado em ${r.enviado_em}. Não mando de novo.` }
  if (new Date(r.expira_em as string).getTime() < Date.now()) {
    return { ok: false, erro: 'Rascunho expirado (vale 30 min). A conversa pode ter andado — prepare de novo.' }
  }

  const agora = new Date().toISOString()
  const { data: travado } = await supabaseAdmin
    .from('mcp_mensagens_rascunho')
    .update({ enviado_em: agora })
    .eq('id', id)
    .is('enviado_em', null)
    .select('id')
    .maybeSingle()

  if (!travado) return { ok: false, erro: 'Outro envio deste rascunho aconteceu agora. Não mando duas vezes.' }

  const waId = r.wa_id as string
  const texto = r.texto as string
  const templateNome = r.template_nome as string | null

  const variaveis = Array.isArray(r.template_variaveis) ? (r.template_variaveis as string[]) : []
  const resultado = templateNome
    ? await enviarTemplate(
        waId,
        templateNome,
        'pt_BR',
        variaveis.length > 0
          ? [{ type: 'body', parameters: variaveis.map((v) => ({ type: 'text', text: String(v) })) }]
          : undefined
      )
    : await enviarTexto(waId, texto)

  if (!resultado.ok) {
    // A Meta recusou, então NADA saiu — devolver o rascunho pra fila em vez de
    // deixá-lo queimado pela trava anti-duplicata. Sem isto, cada recusa exigia
    // preparar tudo de novo, e o agente ficava criando rascunho atrás de
    // rascunho sem corrigir a causa (09/09/2026, erro #132000 de parâmetros).
    await supabaseAdmin
      .from('mcp_mensagens_rascunho')
      .update({ erro: resultado.erro, enviado_em: null })
      .eq('id', id)
    return { ok: false, erro: `O WhatsApp recusou o envio: ${resultado.erro}` }
  }

  await supabaseAdmin.from('mcp_mensagens_rascunho').update({ wamid: resultado.wamid }).eq('id', id)

  // Entra no inbox com etiqueta 'mcp' — a bolha mostra que quem escreveu foi o
  // assistente pelo Cowork. Sem isso a mensagem apareceria como se fosse gente.
  await registrarSaidaInbox(
    waId,
    (r.nome as string | null) ?? null,
    resultado.wamid,
    templateNome ? `[template] ${templateNome}` : texto,
    templateNome,
    'mcp'
  )

  return { ok: true, waId, texto, wamid: resultado.wamid }
}
