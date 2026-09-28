// app/lib/perguntas.ts
// ============================================================================
// Perguntas MEDIADAS entre fornecedor e cliente sobre um pedido — sem troca de
// contato. O fornecedor pergunta na página da oferta OU pelo WhatsApp (o Luigi
// chama perguntarAoCliente); o cliente recebe a pergunta no WhatsApp como uma
// mensagem de gente ("a confecção perguntou: …, me responde por aqui que eu
// repasso") e responde ali mesmo — o Luigi grava a resposta — ou no
// visualizador do pedido; a resposta volta pro fornecedor no WhatsApp e na
// página da oferta. Tudo anonimizado.
//
// POR QUE A PERGUNTA VAI SEM LINK — 28/09/2026 (decisão do Fernando). De
// junho a setembro foram 12 mensagens no thread e só 2 respostas de cliente:
// a pergunta chegava como "responda por aqui: https://…#perguntas" e o
// cliente, que estava no WhatsApp, não ia pro site. Agora a pergunta é uma
// pergunta, e a resposta é o que ele digitar de volta.
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

/** A pergunta, do jeito que uma pessoa mandaria. Exportado pra teste. */
export function textoDaPerguntaAoCliente(primeiroNome: string | null, pergunta: string): string {
  const ola = primeiroNome ? `Oi, ${primeiroNome}! ` : 'Oi! '
  const p = pergunta.trim().replace(/\s+/g, ' ')
  return `${ola}A confecção que está avaliando o seu pedido perguntou: "${p}"\n\nMe responde por aqui que eu repasso pra ela.`
}

/** A resposta do cliente, do jeito que chega à confecção. Exportado pra teste. */
export function textoDaRespostaAoFornecedor(primeiroNome: string | null, codigo: string | null, pergunta: string | null, resposta: string, link: string): string {
  const ola = primeiroNome ? `Oi, ${primeiroNome}! ` : 'Oi! '
  const ref = codigo ? `do pedido ${codigo}` : 'do pedido'
  const sobre = pergunta ? ` sobre "${pergunta.trim().replace(/\s+/g, ' ').slice(0, 160)}"` : ''
  return `${ola}O cliente ${ref} respondeu à sua pergunta${sobre}:\n\n"${resposta.trim()}"\n\nSe fechar pra vocês, o aceite é aqui: ${link}`
}

export type PerguntaPendente = {
  ofertaId: string
  pedidoId: string
  texto: string
  criadoEm: string
}

/**
 * Perguntas de confecção AINDA SEM resposta do cliente, por pedido — a última
 * pergunta de cada oferta que não tem mensagem do cliente depois dela. É o que
 * o Luigi vê quando o cliente escreve.
 */
export async function perguntasPendentesDosPedidos(pedidoIds: string[]): Promise<Map<string, PerguntaPendente[]>> {
  const mapa = new Map<string, PerguntaPendente[]>()
  if (pedidoIds.length === 0) return mapa
  const { data, error } = await supabaseAdmin
    .from('perguntas_oferta')
    .select('id, pedido_id, oferta_id, autor, texto, criado_em')
    .in('pedido_id', pedidoIds)
    .order('criado_em', { ascending: true })
    .returns<(LinhaPerguntaDB & { pedido_id: string; oferta_id: string })[]>()
  if (error) throw new Error(`perguntas pendentes: ${error.message}`)
  // Por oferta, a última mensagem decide: fornecedor = pendente.
  const ultima = new Map<string, LinhaPerguntaDB & { pedido_id: string; oferta_id: string }>()
  for (const r of data ?? []) ultima.set(r.oferta_id, r)
  for (const r of ultima.values()) {
    if (r.autor !== 'fornecedor') continue
    const lista = mapa.get(r.pedido_id) ?? []
    lista.push({ ofertaId: r.oferta_id, pedidoId: r.pedido_id, texto: r.texto, criadoEm: r.criado_em })
    mapa.set(r.pedido_id, lista)
  }
  return mapa
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
        // Uma pessoa perguntando, não um sistema mandando link. A resposta
        // dele cai no Luigi, que grava com responder_pergunta_da_confeccao.
        const msg = textoDaPerguntaAoCliente(primeiroNome, v.valor)
        try {
          await avisoOficial({
            telefone: pedido.telefone,
            nome: pedido.nome ?? null,
            texto: msg,
            resumo: `uma confecção perguntou sobre o seu pedido: "${v.valor.slice(0, 160)}" — me responde por aqui que eu repasso`,
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

  // A resposta vai pra confecção no WhatsApp (best-effort). Antes ela só
  // aparecia na página da oferta, por polling — quem perguntou pelo celular
  // nunca voltava lá pra ver.
  try {
    await avisarFornecedorDaResposta(ofertaId, v.valor)
  } catch (e) {
    console.error('[perguntas] aviso ao fornecedor falhou', ofertaId, e)
  }

  return { ok: true }
}

async function avisarFornecedorDaResposta(ofertaId: string, resposta: string): Promise<void> {
  const { data: oferta } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('id, status, pedidos_assistente(codigo), leads_fornecedores(nome, whatsapp)')
    .eq('id', ofertaId)
    .maybeSingle()
  type F = { nome: string | null; whatsapp: string | null }
  type P = { codigo: string | null }
  type R = { id: string; status: string; pedidos_assistente: P | P[] | null; leads_fornecedores: F | F[] | null }
  const o = oferta as unknown as R | null
  if (!o) return
  const f = Array.isArray(o.leads_fornecedores) ? o.leads_fornecedores[0] : o.leads_fornecedores
  const p = Array.isArray(o.pedidos_assistente) ? o.pedidos_assistente[0] : o.pedidos_assistente
  if (!f?.whatsapp) return
  const { data: ultimaPergunta } = await supabaseAdmin
    .from('perguntas_oferta')
    .select('texto')
    .eq('oferta_id', ofertaId)
    .eq('autor', 'fornecedor')
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle<{ texto: string }>()
  const primeiro = (f.nome ?? '').trim().split(/\s+/)[0] || null
  await avisoOficial({
    telefone: f.whatsapp,
    nome: f.nome,
    texto: textoDaRespostaAoFornecedor(primeiro, p?.codigo ?? null, ultimaPergunta?.texto ?? null, resposta, `${SITE_URL}/fornecedor/oferta/${ofertaId}`),
    resumo: `o cliente ${p?.codigo ? `do pedido ${p.codigo} ` : ''}respondeu à sua pergunta: "${resposta.slice(0, 160)}"`,
    caminhoBotao: `fornecedor/oferta/${ofertaId}`,
  })
}
