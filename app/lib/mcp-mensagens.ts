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

  const janelaAberta = await janela24hAberta(waId)
  if (!janelaAberta && !params.templateNome) {
    return {
      ok: false,
      erro:
        'A janela de 24 h com esse contato está fechada: a Meta só aceita template aprovado. ' +
        'Consulte templates_whatsapp e prepare de novo informando template_nome.',
    }
  }

  const { data, error } = await supabaseAdmin
    .from('mcp_mensagens_rascunho')
    .insert({
      wa_id: waId,
      nome: params.nome ?? null,
      texto,
      template_nome: params.templateNome ?? null,
      template_variaveis: params.templateVariaveis ?? null,
      pedido_id: params.pedidoId ?? null,
      contexto: params.contexto ?? null,
      janela_aberta: janelaAberta,
    })
    .select('id, expira_em')
    .single()

  if (error || !data) return { ok: false, erro: 'Não foi possível gravar o rascunho.' }

  return {
    ok: true,
    rascunho: {
      id: data.id as string,
      waId,
      nome: params.nome ?? null,
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
    await supabaseAdmin.from('mcp_mensagens_rascunho').update({ erro: resultado.erro }).eq('id', id)
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
