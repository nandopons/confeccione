// app/lib/whatsapp-notify.ts
// ============================================================================
// Notificações transacionais pelo WhatsApp OFICIAL (Meta Cloud API).
//
// Primeira função migrada do Z-API: confirmação de pedido recebido.
// Envia o template `pedido_recebido` (utility) e registra a mensagem no
// inbox (/admin/whatsapp), criando contato+conversa se ainda não existem —
// assim, quando o cliente responder, a conversa já tem o histórico.
//
// Failure-soft: retorna false e loga; nunca lança (não pode quebrar o pedido).
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import {
  enviarTemplate,
  enviarTexto,
  enviarMidiaPorId,
  uploadMidia,
  normalizarWaId,
  type EnvioResultado,
  enviarTemplateRetomadaPedido,
  corpoRetomadaPedido,
  TEMPLATE_RETOMADA_PEDIDO,
  enviarBotoes,
  TEMPLATE_FEEDBACK_NEGOCIACAO,
  FEEDBACK_NEG_TITULO_OK,
  FEEDBACK_NEG_TITULO_OUTRO,
  FEEDBACK_NEG_TITULO_OUTRO_TEMPLATE,
  payloadFeedbackNeg,
} from './whatsapp-cloud'
import { gerarResumoPedidoPdf, type ResumoPedido } from './resumo-pdf'

async function vincularContato(waId: string): Promise<{ clienteId: string | null; fornecedorId: string | null }> {
  const last8 = waId.slice(-8)
  const bate = (tel: string | null) => {
    if (!tel) return false
    const dig = tel.replace(/\D/g, '')
    return dig.endsWith(last8) || waId.endsWith(dig.slice(-8))
  }
  const [clientes, fornecedores] = await Promise.all([
    supabaseAdmin.from('contas_clientes').select('id, whatsapp').ilike('whatsapp', `%${last8}`).limit(2),
    supabaseAdmin.from('leads_fornecedores').select('id, whatsapp').ilike('whatsapp', `%${last8}`).limit(2),
  ])
  const cliente = (clientes.data ?? []).find((c) => bate(c.whatsapp))
  const fornecedor = (fornecedores.data ?? []).find((f) => bate(f.whatsapp))
  return { clienteId: cliente?.id ?? null, fornecedorId: fornecedor?.id ?? null }
}

/** Garante wa_contatos + wa_conversas pro telefone; retorna conversaId (ou null). */
async function garantirConversa(waId: string, nome: string | null): Promise<string | null> {
  const { data: contatoExistente } = await supabaseAdmin
    .from('wa_contatos')
    .select('id, nome')
    .eq('wa_id', waId)
    .maybeSingle()

  let contatoId = contatoExistente?.id as string | undefined
  if (!contatoId) {
    const { clienteId, fornecedorId } = await vincularContato(waId)
    const { data: novo, error } = await supabaseAdmin
      .from('wa_contatos')
      .insert({ wa_id: waId, nome, cliente_id: clienteId, fornecedor_id: fornecedorId })
      .select('id')
      .single()
    if (error) {
      const { data: retry } = await supabaseAdmin.from('wa_contatos').select('id').eq('wa_id', waId).maybeSingle()
      contatoId = retry?.id
    } else {
      contatoId = novo.id
    }
  } else if (nome && !contatoExistente?.nome) {
    await supabaseAdmin.from('wa_contatos').update({ nome }).eq('id', contatoId)
  }
  if (!contatoId) return null

  const { data: conversaExistente } = await supabaseAdmin
    .from('wa_conversas')
    .select('id')
    .eq('contato_id', contatoId)
    .maybeSingle()
  if (conversaExistente?.id) return conversaExistente.id

  const { data: nova, error: convErr } = await supabaseAdmin
    .from('wa_conversas')
    .insert({ contato_id: contatoId })
    .select('id')
    .single()
  if (convErr || !nova) {
    const { data: retry } = await supabaseAdmin.from('wa_conversas').select('id').eq('contato_id', contatoId).maybeSingle()
    return retry?.id ?? null
  }
  return nova.id
}

/**
 * Confirmação de pedido recebido via template oficial `pedido_recebido_v2`:
 * corpo com nome + nº do pedido e botão "Acompanhar meu pedido" que abre o
 * painel do cliente com o e-mail pré-preenchido (login?email={{1}}).
 * @returns true se a Meta aceitou o envio (senão o caller pode usar fallback).
 */
export async function notificarPedidoRecebido(params: {
  telefone: string
  nome: string
  protocolo: string
  /** E-mail do cliente — pré-preenche o login do painel no botão. */
  email?: string | null
}): Promise<boolean> {
  try {
    const waId = normalizarWaId(params.telefone)
    if (waId.replace(/\D/g, '').length < 10) return false

    // Sufixo do botão: e-mail urlencoded + UTMs (a Meta cola após login?email=).
    const sufixoBotao =
      encodeURIComponent(params.email ?? '') +
      '&utm_source=whatsapp&utm_medium=template&utm_campaign=pedido_recebido'

    const resultado = await enviarTemplate(waId, 'pedido_recebido_v2', 'pt_BR', [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.nome },
          { type: 'text', text: params.protocolo },
        ],
      },
      {
        type: 'button',
        sub_type: 'url',
        index: 0,
        parameters: [{ type: 'text', text: sufixoBotao }],
      },
    ])
    if (!resultado.ok) {
      console.error('[wa-notify] pedido_recebido falhou', { erro: resultado.erro })
      return false
    }

    // Registra no inbox pro histórico (failure-soft; envio já aconteceu).
    try {
      const conversaId = await garantirConversa(waId, params.nome)
      if (conversaId) {
        const agora = new Date().toISOString()
        const corpo =
          `Oi, ${params.nome}! Recebemos seu pedido nº ${params.protocolo} aqui na Confeccione. ✅\n\n` +
          `Nossa equipe já está buscando o fornecedor ideal pra sua produção. Acompanhe o andamento e fale com a gente pelo seu painel.\n\n` +
          `▸ Acompanhar meu pedido → https://www.confeccione.com.br/cliente/login\n▸ Falar com atendente`
        await supabaseAdmin.from('wa_mensagens').insert({
          conversa_id: conversaId,
          wamid: resultado.wamid,
          direcao: 'saida',
          tipo: 'template',
          corpo,
          status: 'enviando',
          template_nome: 'pedido_recebido_v2',
          criado_em: agora,
        })
        await supabaseAdmin
          .from('wa_conversas')
          .update({ preview: `Você: Pedido nº ${params.protocolo} confirmado ✅`, ultima_mensagem_em: agora })
          .eq('id', conversaId)
      }
    } catch (err) {
      console.error('[wa-notify] registro no inbox falhou', { err })
    }

    return true
  } catch (err) {
    console.error('[wa-notify] exception', { err })
    return false
  }
}


/**
 * Oferta de pedido ao FORNECEDOR via template oficial `oferta_pedido_v2`
 * (utility de verdade, botão direto pra página da oferta). A v1 foi
 * recategorizada pela Meta como MARKETING e passou a ser suprimida pra
 * números em experimento/limite da Meta ("part of an experiment" / "healthy
 * ecosystem engagement") — caso real: Dom Santo, 15/07/2026. Substitui o
 * texto livre do Z-API (assinatura expirada em 07/2026). resumo/condicoes
 * viram linha única (parâmetros da Meta não aceitam quebra de linha).
 * Failure-soft.
 */
/**
 * Template da oferta ao fornecedor.
 *
 * v4 (04/09/2026, pedido do Fernando): ficha seca em vez de parágrafo. O
 * fornecedor decide por quantidade, estado e prazo — o texto de vendas em volta
 * só atrasava a leitura no celular, quase sempre no meio da produção. A copy
 * repete o formato do texto livre antigo do Z-API, que era o que funcionava.
 *
 * Por que v4 e não v3: a v3 foi submetida com a copy anterior e a Meta não
 * deixa editar template em análise — e apagar queima o nome por 30 dias. Sai
 * mais barato pular pra v4 e abandonar a v3.
 *
 * Enquanto a v4 não estiver aprovada, o envio cai sozinho na v2 (ver abaixo).
 */
export const TEMPLATE_OFERTA = 'oferta_pedido_v4'

export async function notificarOfertaFornecedor(params: {
  telefone: string
  nome: string | null
  /** Tipo da peça, do jeito que o fornecedor pensa. ex.: "Bonés" */
  produto: string
  /** ex.: "10 peças" */
  quantidade: string
  /** UF do cliente. ex.: "PE" */
  estado: string
  /** ex.: "15 dias" ou "a combinar" */
  prazo: string
  /** Uma linha com o que caracteriza a peça. ex.: "Bonés azuis, bordado" */
  detalhes: string
  ofertaId: string
}): Promise<boolean> {
  try {
    const waId = normalizarWaId(params.telefone)
    if (waId.replace(/\D/g, '').length < 10) return false

    // Parâmetro da Meta é linha única: quebra de linha derruba o envio.
    const limpa = (s: string, max = 220) =>
      (s || '').replace(/\s*\n+\s*/g, ' · ').replace(/\s{2,}/g, ' ').trim().slice(0, max) || '—'

    const produto = limpa(params.produto, 60)
    const quantidade = limpa(params.quantidade, 40)
    const estado = limpa(params.estado, 30)
    const prazo = limpa(params.prazo, 60)
    const detalhes = limpa(params.detalhes)

    const botao = {
      type: 'button' as const,
      sub_type: 'url' as const,
      index: 0,
      parameters: [{ type: 'text', text: params.ofertaId }],
    }

    let resultado = await enviarTemplate(waId, TEMPLATE_OFERTA, 'pt_BR', [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: produto },
          { type: 'text', text: quantidade },
          { type: 'text', text: estado },
          { type: 'text', text: prazo },
          { type: 'text', text: detalhes },
        ],
      },
      botao,
    ])

    // A v3 só existe depois que a Meta aprovar. Enquanto isso o envio cairia no
    // vazio e o fornecedor simplesmente não receberia a oferta — pior do que uma
    // mensagem feia. Então: falhou a v3, manda a v2 (que já está aprovada).
    let usouFallback = false
    if (!resultado.ok) {
      console.warn('[wa-notify] v3 recusada, caindo pra v2', { erro: resultado.erro })
      usouFallback = true
      const primeiro = (params.nome ?? '').trim().split(/\s+/)[0] || 'parceiro(a)'
      resultado = await enviarTemplate(waId, 'oferta_pedido_v2', 'pt_BR', [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: primeiro },
            { type: 'text', text: `${quantidade} · ${produto} · ${estado}` },
            { type: 'text', text: `prazo ${prazo}` },
          ],
        },
        botao,
      ])
    }

    if (!resultado.ok) {
      console.error('[wa-notify] oferta_pedido falhou', { erro: resultado.erro })
      return false
    }

    // Histórico no inbox (failure-soft; envio já aconteceu).
    try {
      const conversaId = await garantirConversa(waId, params.nome)
      if (conversaId) {
        const agora = new Date().toISOString()
        const link = `https://www.confeccione.com.br/fornecedor/oferta/${params.ofertaId}`
        // O inbox precisa mostrar o texto do template que REALMENTE saiu. Gravar
        // sempre o corpo da v3 fazia o admin ler a ficha nova enquanto o
        // fornecedor recebia o parágrafo da v2 — foi assim que a diferença
        // apareceu no teste de 04/09.
        const primeiroNome = (params.nome ?? '').trim().split(/\s+/)[0] || 'parceiro(a)'
        const corpo = usouFallback
          ? `Oi, ${primeiroNome}! Há um pedido aguardando sua resposta no seu cadastro de fornecedor da Confeccione: ` +
            `${quantidade} · ${produto} · ${estado} — prazo ${prazo}. ` +
            `Acesse pra ver os detalhes e aceitar ou recusar o atendimento.\n▸ Responder ao pedido → ${link}`
          : `Novo pedido:\n\n` +
            `Tipo: ${produto}\n` +
            `Quantidade: ${quantidade}\n` +
            `Estado: ${estado}\n` +
            `Prazo: ${prazo}\n` +
            `Detalhes: ${detalhes}\n\n` +
            `Quer atender este cliente? Toque em Ver pedido.\n▸ ${link}`
        await supabaseAdmin.from('wa_mensagens').insert({
          conversa_id: conversaId,
          wamid: resultado.wamid,
          direcao: 'saida',
          tipo: 'template',
          corpo,
          status: 'enviando',
          template_nome: usouFallback ? 'oferta_pedido_v2' : TEMPLATE_OFERTA,
          criado_em: agora,
        })
        await supabaseAdmin
          .from('wa_conversas')
          .update({ preview: 'Você: Oferta de pedido enviada 🧵', ultima_mensagem_em: agora })
          .eq('id', conversaId)
      }
    } catch (err) {
      console.error('[wa-notify] registro inbox oferta falhou', { err })
    }

    return true
  } catch (err) {
    console.error('[wa-notify] oferta exception', { err })
    return false
  }
}


/**
 * Janela de atendimento de 24h aberta? Só consideramos aberta se o contato
 * mandou mensagem (direcao = entrada) nas últimas 24h — é o espelho local da
 * regra da Meta. Na dúvida (contato/conversa inexistentes, erro de consulta),
 * retorna false: template sempre entrega; texto livre fora da janela nunca.
 */
async function janela24hAberta(waId: string): Promise<boolean> {
  try {
    const { data: contato } = await supabaseAdmin.from('wa_contatos').select('id').eq('wa_id', waId).maybeSingle()
    if (!contato?.id) return false
    const { data: conversa } = await supabaseAdmin.from('wa_conversas').select('id').eq('contato_id', contato.id).maybeSingle()
    if (!conversa?.id) return false
    const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { count } = await supabaseAdmin
      .from('wa_mensagens')
      .select('id', { count: 'exact', head: true })
      .eq('conversa_id', conversa.id)
      .eq('direcao', 'entrada')
      .gte('criado_em', desde)
    return (count ?? 0) > 0
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Resumo do pedido em PDF, como DOCUMENTO no WhatsApp
//
// POR QUE ISTO NÃO É UM LINK NO BOTÃO wa.me
// O atalho de WhatsApp que o fornecedor clica é um `wa.me/...?text=`, e esse
// link só carrega TEXTO — não existe parâmetro de anexo. Arquivo de verdade só
// sai pelo número oficial, pela Cloud API. É o que esta função faz.
//
// A JANELA DE 24h MANDA
// Mídia livre só é aceita quando o contato falou com a gente nas últimas 24h.
// Fora disso a Meta recusa, e não existe fallback: template com cabeçalho de
// documento precisaria de aprovação própria. Por isso a função devolve `false`
// em vez de fingir sucesso — quem chama já mandou o link do PDF no texto do
// aviso, e é esse link que garante a entrega no caso fechado.
//
// GERA UMA VEZ, ENVIA PRA VÁRIOS
// O PDF do pedido é o mesmo pro fornecedor e pro cliente. Gerar e subir duas
// vezes seria pagar dobrado por um arquivo idêntico — o media id da Meta é
// reutilizável entre destinatários do mesmo número.
// ---------------------------------------------------------------------------
type DestinoResumo = { telefone: string; nome: string | null; legenda: string }

export async function enviarResumoPdfPedido(params: {
  pedidoId: string
  destinos: DestinoResumo[]
}): Promise<{ enviados: number; total: number }> {
  const total = params.destinos.length
  if (!total) return { enviados: 0, total: 0 }

  try {
    // Só vale gerar o PDF se ALGUÉM puder receber — a geração lê imagens e
    // monta o documento inteiro, é a parte cara.
    const abertos: { waId: string; destino: DestinoResumo }[] = []
    for (const destino of params.destinos) {
      const waId = normalizarWaId(destino.telefone)
      if (waId.replace(/\D/g, '').length < 10) continue
      if (await janela24hAberta(waId)) abertos.push({ waId, destino })
    }
    if (!abertos.length) return { enviados: 0, total }

    const { data } = await supabaseAdmin
      .from('pedidos_assistente')
      .select('id, codigo, nome, linhas, prazo_dias, cep, numero, complemento, logradouro, bairro, cidade, uf, mockups, imagens')
      .eq('id', params.pedidoId)
      .maybeSingle<Record<string, unknown>>()
    if (!data) return { enviados: 0, total }

    const pedido: ResumoPedido = {
      id: String(data.id),
      nome: (data.nome as string | null) ?? null,
      linhas: Array.isArray(data.linhas) ? (data.linhas as ResumoPedido['linhas']) : [],
      prazoDias: (data.prazo_dias as number | null) ?? null,
      cep: (data.cep as string | null) ?? null,
      numero: (data.numero as string | null) ?? null,
      complemento: (data.complemento as string | null) ?? null,
      logradouro: (data.logradouro as string | null) ?? null,
      bairro: (data.bairro as string | null) ?? null,
      cidade: (data.cidade as string | null) ?? null,
      uf: (data.uf as string | null) ?? null,
      codigo: (data.codigo as string | null) ?? null,
      mockups: (data.mockups as ResumoPedido['mockups']) ?? null,
      imagens: Array.isArray(data.imagens) ? (data.imagens as string[]) : null,
    }

    const bytes = await gerarResumoPedidoPdf(pedido)
    // `bytes.buffer` pode ser maior que o conteúdo (Uint8Array é uma janela
    // sobre o buffer). O slice recorta exatamente o PDF.
    const arquivo = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const nomeArquivo = `confeccione-pedido-${pedido.id.slice(0, 8)}.pdf`

    const up = await uploadMidia(arquivo, 'application/pdf', nomeArquivo)
    if (!up.ok) {
      console.error('[wa-notify] upload do resumo em PDF falhou', { erro: up.erro })
      return { enviados: 0, total }
    }

    let enviados = 0
    for (const { waId, destino } of abertos) {
      const r = await enviarMidiaPorId(waId, 'document', up.mediaId, {
        caption: destino.legenda.slice(0, 1024),
        filename: nomeArquivo,
      })
      if (!r.ok) {
        console.error('[wa-notify] envio do resumo em PDF falhou', { erro: r.erro })
        continue
      }
      enviados++
      try {
        const conversaId = await garantirConversa(waId, destino.nome)
        if (conversaId) {
          const agora = new Date().toISOString()
          await supabaseAdmin.from('wa_mensagens').insert({
            conversa_id: conversaId,
            wamid: r.wamid,
            direcao: 'saida',
            tipo: 'document',
            corpo: destino.legenda,
            midia_mime: 'application/pdf',
            midia_nome: nomeArquivo,
            status: 'enviando',
            criado_em: agora,
          })
          await supabaseAdmin
            .from('wa_conversas')
            .update({ preview: `Você: 📄 ${nomeArquivo}`, ultima_mensagem_em: agora })
            .eq('id', conversaId)
        }
      } catch (err) {
        console.error('[wa-notify] registro inbox do PDF falhou', { err })
      }
    }
    return { enviados, total }
  } catch (err) {
    console.error('[wa-notify] enviarResumoPdfPedido exception', { err })
    return { enviados: 0, total }
  }
}

/**
 * Aviso transacional pelo número OFICIAL com fallback de template:
 * 1) TEXTO LIVRE (grátis) — só quando a janela de 24h está comprovadamente
 *    aberta (pré-check no banco). Fora da janela a Meta ACEITA o envio na
 *    hora (devolve wamid) e derruba DEPOIS via webhook com o erro 131047
 *    "Re-engagement message" — o erro síncrono nunca vem, então confiar nele
 *    deixava o aviso morrer sem fallback (caso real: orçamento da Samantha,
 *    15/07/2026).
 * 2) Janela fechada (ou texto livre recusado na hora): template
 *    `pedido_atualizacao` (utility) com o resumo curto e botão pro caminho
 *    informado (site/{{1}}).
 * Substitui o Z-API nos avisos de aceite, pagamento, orçamento, perguntas etc.
 * Failure-soft. Registra a saída no inbox.
 */
export async function avisoOficial(params: {
  telefone: string
  nome: string | null
  /** Mensagem completa (rica) — usada quando a janela de 24h está aberta. */
  texto: string
  /** Resumo curto pro fallback de template (sem quebras de linha). */
  resumo: string
  /** Caminho no site pro botão do template, ex.: `visualizador/<id>`. */
  caminhoBotao: string
}): Promise<boolean> {
  try {
    const waId = normalizarWaId(params.telefone)
    if (waId.replace(/\D/g, '').length < 10) return false

    const primeiro = (params.nome ?? '').trim().split(/\s+/)[0] || 'cliente'
    let corpoRegistrado = params.texto
    let templateUsado: string | null = null

    let resultado: EnvioResultado = { ok: false, erro: 'Janela de 24h fechada (pré-check) — indo direto pro template' }
    if (await janela24hAberta(waId)) {
      resultado = await enviarTexto(waId, params.texto)
    }
    if (!resultado.ok) {
      // Fora da janela de 24h (ou texto livre recusado) → template utility genérico com botão.
      const resumo = params.resumo.replace(/\s*\n+\s*/g, ' · ').replace(/\s{2,}/g, ' ').trim().slice(0, 300)
      resultado = await enviarTemplate(waId, 'pedido_atualizacao', 'pt_BR', [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: primeiro },
            { type: 'text', text: resumo },
          ],
        },
        { type: 'button', sub_type: 'url', index: 0, parameters: [{ type: 'text', text: params.caminhoBotao }] },
      ])
      corpoRegistrado =
        `Oi, ${primeiro}! Atualização do seu pedido na Confeccione: ${resumo}. Toque no botão pra ver os detalhes e continuar por lá.\n` +
        `▸ Ver detalhes → https://www.confeccione.com.br/${params.caminhoBotao}`
      templateUsado = 'pedido_atualizacao'
    }
    if (!resultado.ok) {
      console.error('[wa-notify] avisoOficial falhou', { erro: resultado.erro })
      return false
    }

    await registrarSaidaInbox(waId, params.nome, resultado.wamid, corpoRegistrado, templateUsado)

    return true
  } catch (err) {
    console.error('[wa-notify] avisoOficial exception', { err })
    return false
  }
}

/**
 * Espelha uma mensagem de saída (já enviada pela Cloud API) no inbox
 * (wa_mensagens + preview da conversa). Failure-soft: erro aqui nunca
 * desfaz um envio que já aconteceu.
 */
async function registrarSaidaInbox(
  waId: string,
  nome: string | null,
  wamid: string | undefined,
  corpo: string,
  templateNome: string | null
): Promise<void> {
  try {
    const conversaId = await garantirConversa(waId, nome)
    if (!conversaId) return
    const agora = new Date().toISOString()
    await supabaseAdmin.from('wa_mensagens').insert({
      conversa_id: conversaId,
      wamid,
      direcao: 'saida',
      tipo: templateNome ? 'template' : 'text',
      corpo,
      status: 'enviando',
      template_nome: templateNome,
      criado_em: agora,
    })
    await supabaseAdmin
      .from('wa_conversas')
      .update({ preview: `Você: ${corpo.slice(0, 110)}`, ultima_mensagem_em: agora })
      .eq('id', conversaId)
  } catch (err) {
    console.error('[wa-notify] registro inbox saída falhou', { err })
  }
}

/**
 * Lembrete "continuar meu pedido" pelo número OFICIAL: template de marketing
 * retomar_pedido_v3 (funciona fora da janela de 24h) + espelho no inbox pra
 * conversa aparecer no /admin/whatsapp. Failure-soft.
 */
export async function lembreteRetomadaOficial(params: {
  telefone: string
  nome: string | null
  pedidoId: string
}): Promise<boolean> {
  try {
    const waId = normalizarWaId(params.telefone)
    if (waId.replace(/\D/g, '').length < 10) return false
    const resultado = await enviarTemplateRetomadaPedido(waId, params.nome, params.pedidoId)
    if (!resultado.ok) {
      console.error('[wa-notify] lembreteRetomadaOficial falhou', { erro: resultado.erro })
      return false
    }
    await registrarSaidaInbox(
      waId,
      params.nome,
      resultado.wamid,
      corpoRetomadaPedido(params.nome, params.pedidoId),
      TEMPLATE_RETOMADA_PEDIDO
    )
    return true
  } catch (err) {
    console.error('[wa-notify] lembreteRetomadaOficial exception', { err })
    return false
  }
}

/**
 * Pergunta ao CLIENTE como está a negociação com o fornecedor que aceitou.
 * Dentro da janela de 24h: mensagem interativa com 2 botões de resposta.
 * Fora: template utility feedback_negociacao com os mesmos 2 quick replies.
 * O clique volta pelo webhook com payload feedback_neg_ok|outro:<pedidoId>.
 * Espelhado no inbox. Failure-soft.
 */
export async function feedbackNegociacaoOficial(params: {
  telefone: string
  nome: string | null
  pedidoId: string
  fornecedorNome: string | null
}): Promise<boolean> {
  try {
    const waId = normalizarWaId(params.telefone)
    if (waId.replace(/\D/g, '').length < 10) return false

    const primeiro = (params.nome ?? '').trim().split(/\s+/)[0] || 'cliente'
    const forn = (params.fornecedorNome ?? '').trim() || 'o fornecedor'
    const corpo = `Oi, ${primeiro}! Seu pedido na Confeccione está com ${forn}. Como está a conversa com eles — foi bem atendido?`
    const idOk = payloadFeedbackNeg('ok', params.pedidoId)
    const idOutro = payloadFeedbackNeg('outro', params.pedidoId)

    let resultado: EnvioResultado = { ok: false, erro: 'Janela de 24h fechada (pré-check) — indo direto pro template' }
    let templateUsado: string | null = null
    let corpoRegistrado = `${corpo}\n▸ ${FEEDBACK_NEG_TITULO_OK}  ▸ ${FEEDBACK_NEG_TITULO_OUTRO}`
    if (await janela24hAberta(waId)) {
      resultado = await enviarBotoes(waId, corpo, [
        { id: idOk, titulo: FEEDBACK_NEG_TITULO_OK },
        { id: idOutro, titulo: FEEDBACK_NEG_TITULO_OUTRO },
      ])
    }
    if (!resultado.ok) {
      resultado = await enviarTemplate(waId, TEMPLATE_FEEDBACK_NEGOCIACAO, 'pt_BR', [
        { type: 'body', parameters: [{ type: 'text', text: primeiro }, { type: 'text', text: forn.slice(0, 60) }] },
        { type: 'button', sub_type: 'quick_reply', index: 0, parameters: [{ type: 'payload', payload: idOk }] },
        { type: 'button', sub_type: 'quick_reply', index: 1, parameters: [{ type: 'payload', payload: idOutro }] },
      ])
      templateUsado = TEMPLATE_FEEDBACK_NEGOCIACAO
      corpoRegistrado = `${corpo}\n▸ ${FEEDBACK_NEG_TITULO_OK}  ▸ ${FEEDBACK_NEG_TITULO_OUTRO_TEMPLATE}`
    }
    if (!resultado.ok) {
      console.error('[wa-notify] feedbackNegociacaoOficial falhou', { erro: resultado.erro })
      return false
    }
    await registrarSaidaInbox(waId, params.nome, resultado.wamid, corpoRegistrado, templateUsado)
    return true
  } catch (err) {
    console.error('[wa-notify] feedbackNegociacaoOficial exception', { err })
    return false
  }
}

/**
 * Resposta do cliente ao feedback da negociação (chamado pelo webhook).
 * "outro" → reabre o pedido (cancela a oferta aceita, limpa orçamento) e
 * avisa o cliente; "ok" → só agradece. Texto livre: o clique reabriu a
 * janela de 24h. Failure-soft.
 */
export async function responderFeedbackNegociacao(params: {
  waId: string
  nome: string | null
  acao: 'ok' | 'outro'
  pedidoId: string
}): Promise<void> {
  try {
    let texto: string
    if (params.acao === 'outro') {
      const { reabrirPedido } = await import('./pedido-assistente-oferta')
      const r = await reabrirPedido(params.pedidoId)
      texto = r.ok
        ? 'Entendido. Vamos buscar outro fornecedor pro seu pedido e te avisamos por aqui assim que tiver novidade.'
        : 'Entendido. Nossa equipe vai olhar seu pedido e te retorna por aqui em breve.'
      if (!r.ok) console.error('[wa-notify] reabrirPedido via feedback falhou', { pedidoId: params.pedidoId, erro: r.erro })
    } else {
      texto = 'Que bom! Qualquer coisa, é só chamar por aqui.'
    }
    const resultado = await enviarTexto(params.waId, texto)
    if (resultado.ok) await registrarSaidaInbox(params.waId, params.nome, resultado.wamid, texto, null)
  } catch (err) {
    console.error('[wa-notify] responderFeedbackNegociacao exception', { err })
  }
}

/**
 * Cliente tocou em "Falar com atendente" (quick reply do lembrete). A mensagem
 * já caiu no inbox como não lida; aqui só confirmamos que alguém vai responder.
 * Texto livre: o clique abriu a janela de 24h. Failure-soft.
 */
export async function responderPedidoAtendente(waId: string, nome: string | null): Promise<void> {
  try {
    const primeiro = (nome ?? '').trim().split(/\s+/)[0]
    const texto = `Certo${primeiro ? `, ${primeiro}` : ''}. Um atendente da Confeccione vai falar com você por aqui em instantes.`
    const r = await enviarTexto(waId, texto)
    if (r.ok) await registrarSaidaInbox(waId, nome, r.wamid, texto, null)
  } catch (err) {
    console.error('[wa-notify] responderPedidoAtendente exception', { err })
  }
}
