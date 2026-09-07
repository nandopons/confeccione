// app/lib/envio-marketing.ts
// ============================================================================
// O ENVIO UNITÁRIO de marketing, num lugar só — usado por campanhas (disparo
// manual) e por automações (fluxos). Quem chama decide QUEM recebe; aqui a
// gente resolve COMO a mensagem sai.
//
// Canais:
//   email       → Resend, com link de descadastro no rodapé
//   whatsapp    → template aprovado na Meta (fora da janela de 24h é a única
//                 forma legítima de iniciar conversa) ou texto puro via Z-API
//   mala_direta → peça física: não tem envio automático. Retorna 'nao_enviavel'
//                 pra quem chamou tratar (a peça entra em lista de postagem).
// ============================================================================

import { enviarMensagem } from './zapi'
import { enviarTemplate, normalizarWaId } from './whatsapp-cloud'
import { enviarEmailMarketing } from './email'
import { visualizadorPedidoUrl } from './url'
import type { Lead } from './leads-marketing'

export type CanalEnvio = 'email' | 'whatsapp' | 'mala_direta'

/** O conteúdo já resolvido — vem de um template ou direto de uma campanha. */
export type ConteudoEnvio = {
  canal: CanalEnvio
  assunto?: string | null
  mensagem: string
  templateMeta?: string | null
  templateParams?: { corpo: string[]; botaoUrl?: string }
  usaTemplateOficial?: boolean
}

export type ResultadoEnvio = {
  ok: boolean
  mensagem: string
  erro?: string
  naoEnviavel?: boolean
}

/**
 * Troca os marcadores pelos dados do lead:
 *   #nome    primeiro nome (some junto com a vírgula se não houver nome)
 *   #empresa #cidade
 *   #link    link do pedido do lead no visualizador (se ele tiver pedido)
 *   #pedido  só o id do pedido — serve pro sufixo do botão de URL do template
 */
export function aplicarPlaceholders(texto: string, lead: Lead): string {
  const primeiro = (lead.nome ?? '').trim().split(/\s+/)[0] ?? ''
  let out = primeiro
    ? texto.split('#nome').join(primeiro)
    : texto.replace(/ ?,? ?#nome/g, '').replace(/ {2,}/g, ' ')
  out = out.split('#empresa').join(lead.empresa ?? '')
  out = out.split('#cidade').join(lead.cidade ?? '')
  if (lead.pedidoId) {
    out = out.split('#link').join(visualizadorPedidoUrl(lead.pedidoId))
    out = out.split('#pedido').join(lead.pedidoId)
  } else {
    out = out.split('#link').join('https://www.confeccione.com.br')
    out = out.split('#pedido').join('')
  }
  return out.trim()
}

/** O canal precisa de WhatsApp, e-mail ou endereço? */
export function contatoNecessario(canal: CanalEnvio): 'whatsapp' | 'email' | 'endereco' {
  if (canal === 'email') return 'email'
  if (canal === 'mala_direta') return 'endereco'
  return 'whatsapp'
}

/** O lead tem o contato que esse canal exige? */
export function leadAlcancavel(lead: Lead, canal: CanalEnvio): boolean {
  const precisa = contatoNecessario(canal)
  if (precisa === 'email') return !!lead.email
  if (precisa === 'endereco') return !!(lead.cep && lead.logradouro)
  return !!lead.telefone
}

export async function enviarConteudo(c: ConteudoEnvio, lead: Lead): Promise<ResultadoEnvio> {
  const corpo = aplicarPlaceholders(c.mensagem, lead)

  if (c.canal === 'mala_direta') {
    return { ok: false, mensagem: corpo, naoEnviavel: true, erro: 'peça física — entra na lista de postagem' }
  }

  if (c.canal === 'email') {
    if (!lead.email) return { ok: false, mensagem: corpo, erro: 'lead sem e-mail' }
    const assunto = aplicarPlaceholders(c.assunto?.trim() || 'Confeccione', lead)
    const r = await enviarEmailMarketing({ para: lead.email, assunto, corpo, leadId: lead.id })
    return { ok: r.ok, mensagem: `${assunto}\n\n${corpo}`, erro: r.erro }
  }

  // ── WhatsApp ──
  if (!lead.telefone) return { ok: false, mensagem: corpo, erro: 'lead sem WhatsApp' }

  // Texto puro (Z-API): sem custo e sem aprovação, mas só pra base morna —
  // em base fria é o caminho mais curto pro número ser banido.
  if (c.usaTemplateOficial === false || !c.templateMeta) {
    if (!c.templateMeta && c.usaTemplateOficial !== false) {
      return { ok: false, mensagem: corpo, erro: 'template oficial não definido' }
    }
    try {
      const ok = await enviarMensagem(lead.telefone, corpo)
      return { ok, mensagem: corpo, erro: ok ? undefined : 'Z-API recusou o envio' }
    } catch (e) {
      return { ok: false, mensagem: corpo, erro: e instanceof Error ? e.message : 'falha Z-API' }
    }
  }

  // Template aprovado na Meta.
  const params = (c.templateParams?.corpo ?? []).map((p) => ({
    type: 'text',
    text: aplicarPlaceholders(p, lead) || '-',
  }))
  const components: unknown[] = []
  if (params.length) components.push({ type: 'body', parameters: params })
  const botao = c.templateParams?.botaoUrl?.trim()
  if (botao) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: 0,
      parameters: [{ type: 'text', text: aplicarPlaceholders(botao, lead) }],
    })
  }
  try {
    const r = await enviarTemplate(normalizarWaId(lead.telefone), c.templateMeta, 'pt_BR', components)
    return {
      ok: r.ok,
      mensagem: corpo || `[template ${c.templateMeta}]`,
      erro: r.ok ? undefined : 'Meta recusou o envio',
    }
  } catch (e) {
    return { ok: false, mensagem: corpo, erro: e instanceof Error ? e.message : 'falha Meta' }
  }
}
