// app/lib/perguntas.ts
// ============================================================================
// Perguntas MEDIADAS entre fornecedor e cliente sobre um pedido — sem troca de
// contato. O fornecedor pergunta na página da oferta; o cliente é notificado
// (WhatsApp + e-mail da Confeccione) e responde no visualizador do pedido; a
// resposta volta pro fornecedor (que vê via polling). Tudo anonimizado.
//
// Tabela: public.perguntas_oferta (id, pedido_id, oferta_id, autor, texto,
// criado_em). Acesso via service role (supabaseAdmin).
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import { avisoOficial } from './whatsapp-notify'
import { SITE_URL } from './url'
import { emailNovaPergunta } from './email'

export type MensagemPergunta = {
  id: string
  autor: 'fornecedor' | 'cliente'
  texto: string
  criadoEm: string
}

const MAX_TEXTO = 1000

type LinhaPerguntaDB = {
  id: string
  autor: 'fornecedor' | 'cliente'
  texto: string
  criado_em: string
}

function validarTexto(texto: unknown): { ok: true; valor: string } | { ok: false; erro: string } {
  if (typeof texto !== 'string') return { ok: false, erro: 'Texto inválido.' }
  const t = texto.trim()
  if (!t) return { ok: false, erro: 'Escreva a sua mensagem.' }
  if (t.length > MAX_TEXTO) return { ok: false, erro: `Mensagem muito longa (máx. ${MAX_TEXTO} caracteres).` }
  return { ok: true, valor: t }
}

function mapMensagem(r: LinhaPerguntaDB): MensagemPergunta {
  return { id: r.id, autor: r.autor, texto: r.texto, criadoEm: r.criado_em }
}

/** Todas as mensagens de uma oferta, ordenadas por data (asc). */
export async function listarThreadOferta(ofertaId: string): Promise<MensagemPergunta[]> {
  const { data, error } = await supabaseAdmin
    .from('perguntas_oferta')
    .select('id, autor, texto, criado_em')
    .eq('oferta_id', ofertaId)
    .order('criado_em', { ascending: true })
    .returns<LinhaPerguntaDB[]>()

  if (error) {
    console.error('[perguntas] listarThreadOferta falhou', ofertaId, error)
    return []
  }
  return (data ?? []).map(mapMensagem)
}

/**
 * O FORNECEDOR faz uma pergunta na página da oferta. Insere a mensagem e
 * notifica o cliente (WhatsApp + e-mail) em best-effort — notificação nunca
 * derruba a operação.
 */
export async function criarPerguntaFornecedor(
  ofertaId: string,
  texto: string
): Promise<{ ok: boolean; erro?: string }> {
  const v = validarTexto(texto)
  if (!v.ok) return { ok: false, erro: v.erro }

  const { data: oferta } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('id, pedido_id')
    .eq('id', ofertaId)
    .maybeSingle<{ id: string; pedido_id: string }>()

  if (!oferta) return { ok: false, erro: 'Oferta não encontrada.' }

  const { error: insErr } = await supabaseAdmin.from('perguntas_oferta').insert({
    pedido_id: oferta.pedido_id,
    oferta_id: oferta.id,
    autor: 'fornecedor',
    texto: v.valor,
  })

  if (insErr) {
    console.error('[perguntas] criarPerguntaFornecedor insert falhou', ofertaId, insErr)
    return { ok: false, erro: 'Não foi possível registrar a pergunta.' }
  }

  // Notifica o cliente — best-effort, nunca lança.
  try {
    const { data: pedido } = await supabaseAdmin
      .from('pedidos_assistente')
      .select('nome, telefone, email')
      .eq('id', oferta.pedido_id)
      .maybeSingle<{ nome: string | null; telefone: string | null; email: string | null }>()

    if (pedido) {
      const link = `${SITE_URL}/visualizador/${oferta.pedido_id}#perguntas`
      const primeiroNome = pedido.nome ? pedido.nome.split(' ')[0] : null

      if (pedido.telefone) {
        const msg =
          `💬 *Confeccione*\n\n` +
          `${primeiroNome ? `Oi, ${primeiroNome}! ` : 'Oi! '}` +
          `Um fornecedor tem uma *pergunta* sobre o seu pedido.\n\n` +
          `"${v.valor}"\n\n` +
          `Responda por aqui (sem precisar trocar contato):\n${link}`
        try {
          await avisoOficial({
            telefone: pedido.telefone,
            nome: pedido.nome ?? null,
            texto: msg,
            resumo: 'O fornecedor fez uma pergunta sobre o seu pedido — responda pela plataforma',
            caminhoBotao: `visualizador/${oferta.pedido_id}`,
          })
        } catch (e) {
          console.error('[perguntas] WhatsApp ao cliente falhou', oferta.pedido_id, e)
        }
      }

      if (pedido.email) {
        try {
          await emailNovaPergunta({ email: pedido.email, nome: pedido.nome, pergunta: v.valor, link })
        } catch (e) {
          console.error('[perguntas] e-mail ao cliente falhou', oferta.pedido_id, e)
        }
      }
    }
  } catch (e) {
    console.error('[perguntas] notificação ao cliente falhou', oferta.pedido_id, e)
  }

  return { ok: true }
}

/**
 * Todas as threads de um pedido, agrupadas por oferta, com rótulo anônimo
 * ("Fornecedor 1", "Fornecedor 2"…) ordenado pela 1a mensagem de cada thread.
 * Só inclui threads com ao menos uma mensagem. NUNCA revela identidade.
 */
export async function listarThreadsPedido(
  pedidoId: string
): Promise<{ ofertaId: string; label: string; mensagens: MensagemPergunta[] }[]> {
  const { data, error } = await supabaseAdmin
    .from('perguntas_oferta')
    .select('id, oferta_id, autor, texto, criado_em')
    .eq('pedido_id', pedidoId)
    .order('criado_em', { ascending: true })
    .returns<(LinhaPerguntaDB & { oferta_id: string })[]>()

  if (error) {
    console.error('[perguntas] listarThreadsPedido falhou', pedidoId, error)
    return []
  }

  // Agrupa preservando a ordem de aparição (primeira mensagem) por oferta.
  const ordem: string[] = []
  const grupos = new Map<string, MensagemPergunta[]>()
  for (const r of data ?? []) {
    if (!grupos.has(r.oferta_id)) {
      grupos.set(r.oferta_id, [])
      ordem.push(r.oferta_id)
    }
    grupos.get(r.oferta_id)!.push(mapMensagem(r))
  }

  return ordem.map((ofertaId, idx) => ({
    ofertaId,
    label: `Fornecedor ${idx + 1}`,
    mensagens: grupos.get(ofertaId) ?? [],
  }))
}

/**
 * O CLIENTE responde a uma thread no visualizador. Valida o texto e confirma
 * que a oferta pertence ao pedido (há mensagem prévia OU a oferta tem esse
 * pedido_id). Insere autor='cliente'. v1: não notifica o fornecedor (ele vê
 * por polling).
 */
export async function responderPerguntaCliente(
  pedidoId: string,
  ofertaId: string,
  texto: string
): Promise<{ ok: boolean; erro?: string }> {
  const v = validarTexto(texto)
  if (!v.ok) return { ok: false, erro: v.erro }

  // A oferta tem que pertencer a este pedido.
  const { data: existente } = await supabaseAdmin
    .from('perguntas_oferta')
    .select('id')
    .eq('pedido_id', pedidoId)
    .eq('oferta_id', ofertaId)
    .limit(1)
    .maybeSingle<{ id: string }>()

  let pertence = !!existente
  if (!pertence) {
    const { data: oferta } = await supabaseAdmin
      .from('ofertas_pedido_assistente')
      .select('id, pedido_id')
      .eq('id', ofertaId)
      .maybeSingle<{ id: string; pedido_id: string }>()
    pertence = !!oferta && oferta.pedido_id === pedidoId
  }

  if (!pertence) return { ok: false, erro: 'Conversa não encontrada para este pedido.' }

  const { error: insErr } = await supabaseAdmin.from('perguntas_oferta').insert({
    pedido_id: pedidoId,
    oferta_id: ofertaId,
    autor: 'cliente',
    texto: v.valor,
  })

  if (insErr) {
    console.error('[perguntas] responderPerguntaCliente insert falhou', pedidoId, ofertaId, insErr)
    return { ok: false, erro: 'Não foi possível registrar a resposta.' }
  }

  return { ok: true }
}
