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
import { enviarTemplate, enviarTexto, normalizarWaId, type EnvioResultado } from './whatsapp-cloud'

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
export async function notificarOfertaFornecedor(params: {
  telefone: string
  nome: string | null
  /** ex.: "50x camiseta preta · 50 peças" */
  resumo: string
  /** ex.: "prazo 21 dias · repasse R$ 2.500,00" */
  condicoes: string
  ofertaId: string
}): Promise<boolean> {
  try {
    const waId = normalizarWaId(params.telefone)
    if (waId.replace(/\D/g, '').length < 10) return false

    const primeiro = (params.nome ?? '').trim().split(/\s+/)[0] || 'parceiro(a)'
    const limpa = (s: string) => s.replace(/\s*\n+\s*/g, ' · ').replace(/\s{2,}/g, ' ').trim().slice(0, 300)
    const resumo = limpa(params.resumo)
    const condicoes = limpa(params.condicoes)

    const resultado = await enviarTemplate(waId, 'oferta_pedido_v2', 'pt_BR', [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: primeiro },
          { type: 'text', text: resumo },
          { type: 'text', text: condicoes },
        ],
      },
      { type: 'button', sub_type: 'url', index: 0, parameters: [{ type: 'text', text: params.ofertaId }] },
    ])
    if (!resultado.ok) {
      console.error('[wa-notify] oferta_pedido falhou', { erro: resultado.erro })
      return false
    }

    // Histórico no inbox (failure-soft; envio já aconteceu).
    try {
      const conversaId = await garantirConversa(waId, params.nome)
      if (conversaId) {
        const agora = new Date().toISOString()
        const corpo =
          `Oi, ${primeiro}! Há um pedido aguardando sua resposta no seu cadastro de fornecedor da Confeccione: ${resumo} — ${condicoes}. ` +
          `Acesse pra ver os detalhes e aceitar ou recusar o atendimento.\n` +
          `▸ Responder ao pedido → https://www.confeccione.com.br/fornecedor/oferta/${params.ofertaId}`
        await supabaseAdmin.from('wa_mensagens').insert({
          conversa_id: conversaId,
          wamid: resultado.wamid,
          direcao: 'saida',
          tipo: 'template',
          corpo,
          status: 'enviando',
          template_nome: 'oferta_pedido_v2',
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

    try {
      const conversaId = await garantirConversa(waId, params.nome)
      if (conversaId) {
        const agora = new Date().toISOString()
        await supabaseAdmin.from('wa_mensagens').insert({
          conversa_id: conversaId,
          wamid: resultado.wamid,
          direcao: 'saida',
          tipo: templateUsado ? 'template' : 'text',
          corpo: corpoRegistrado,
          status: 'enviando',
          template_nome: templateUsado,
          criado_em: agora,
        })
        await supabaseAdmin
          .from('wa_conversas')
          .update({ preview: `Você: ${corpoRegistrado.slice(0, 110)}`, ultima_mensagem_em: agora })
          .eq('id', conversaId)
      }
    } catch (err) {
      console.error('[wa-notify] registro inbox aviso falhou', { err })
    }

    return true
  } catch (err) {
    console.error('[wa-notify] avisoOficial exception', { err })
    return false
  }
}
