// app/lib/envio-marketing.ts
// ============================================================================
// O ENVIO UNITÁRIO de marketing, num lugar só — usado por campanhas (disparo
// manual) e por automações (fluxos). Quem chama decide QUEM recebe; aqui a
// gente resolve COMO a mensagem sai.
//
// Canais:
//   email       → Resend, com link de descadastro no rodapé
//   whatsapp    → template aprovado na Meta. Só isso: fora da janela de 24h é a
//                 única forma legítima (e possível) de iniciar conversa
//   mala_direta → peça física: não tem envio automático. Retorna 'nao_enviavel'
//                 pra quem chamou tratar (a peça entra em lista de postagem).
// ============================================================================

import { enviarTemplate, normalizarWaId } from './whatsapp-cloud'
import { enviarEmailMarketing } from './email'
import { visualizadorPedidoUrl } from './url'
import { renderBlocosHtml, type Bloco } from './email-blocos'
import type { Lead } from './leads-marketing'

export type CanalEnvio = 'email' | 'whatsapp' | 'mala_direta'

/** O conteúdo já resolvido — vem de um template ou direto de uma campanha. */
export type ConteudoEnvio = {
  canal: CanalEnvio
  assunto?: string | null
  mensagem: string
  /** 'blocos' → o corpo visual vem de `blocos`; `mensagem` é a versão texto. */
  formato?: 'texto' | 'blocos'
  blocos?: Bloco[]
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
 *   #pedido  o id do pedido — SÓ pro sufixo do botão de URL do template.
 *            Não use no corpo: é um uuid, e o cliente veria
 *            "seu pedido 3f2a...-9c1b" no WhatsApp. O número que ele conhece é
 *            o `codigo` (20260900268), que não está no lead.
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
    // Nos e-mails de bloco, os marcadores são trocados no HTML já renderizado —
    // assim eles funcionam também dentro de link de botão (#link, #pedido).
    const html =
      c.formato === 'blocos' && c.blocos?.length
        ? aplicarPlaceholders(renderBlocosHtml(c.blocos), lead)
        : undefined
    const r = await enviarEmailMarketing({ para: lead.email, assunto, corpo, html, leadId: lead.id })
    return { ok: r.ok, mensagem: `${assunto}\n\n${corpo}`, erro: r.erro }
  }

  // ── WhatsApp ──
  if (!lead.telefone) return { ok: false, mensagem: corpo, erro: 'lead sem WhatsApp' }

  // TEXTO PURO NÃO SAI MAIS DAQUI — 09/09/2026.
  // Esse ramo mandava por Z-API, que foi desligada em 07/09 sem substituto. Ele
  // continuava no código chamando um serviço morto: o envio falhava, o motor
  // marcava `motivo_saida` e no segundo erro tirava a pessoa do fluxo. Ou seja,
  // um template mal configurado não avisava ninguém — ia comendo a fila em
  // silêncio.
  //
  // Fora da janela de 24h a Cloud API só aceita template aprovado, então
  // "template não definido" não é uma variação de configuração: é um fluxo que
  // não tem como enviar. Falha na cara, com o nome do template no erro.
  if (c.usaTemplateOficial === false || !c.templateMeta) {
    return {
      ok: false,
      mensagem: corpo,
      erro: 'template oficial não definido — fora da janela de 24h a Meta só aceita template aprovado',
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
    // O ERRO DA META VAI INTEIRO — 09/09/2026.
    // Antes isso virava "Meta recusou o envio". A mensagem real ("Number of
    // parameters does not match") ficava só no log, e quem lia o painel achava
    // que o problema era o número do cliente. Custou uma manhã de diagnóstico
    // errado no caso da Nicole.
    return {
      ok: r.ok,
      mensagem: corpo || `[template ${c.templateMeta}]`,
      erro: r.ok ? undefined : `${c.templateMeta}: ${r.erro}`,
    }
  } catch (e) {
    return { ok: false, mensagem: corpo, erro: e instanceof Error ? e.message : 'falha Meta' }
  }
}
