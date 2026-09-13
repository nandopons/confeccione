// app/lib/pedido-linhas-edicao.ts
// ============================================================================
// Edição das LINHAS de um pedido do chat (pedidos_assistente) pelos dois lados
// da negociação, antes/durante o orçamento:
//   - cliente  → visualizador (PATCH /api/pedido/assistente/[id])
//   - fornecedor que aceitou → página da oferta (PATCH /api/fornecedor/oferta/[id]/linhas)
//
// Decisões (02/09/2026, Fernando):
//   1. Edição vale NA HORA — o outro lado é avisado pelo WhatsApp oficial.
//   2. Fornecedor pode editar mesmo com orçamento 'definido': o orçamento volta
//      a 'aguardando_fornecedor' (valores ficam como rascunho) e ele reenvia.
//
// O que este módulo garante:
//   - lid estável em toda linha (uuid), pra casar versões e pra badge no cliente
//   - mockups/artes (indexados por POSIÇÃO em pedidos_assistente.mockups) são
//     re-mapeados quando o fornecedor remove/reordena linhas (via origIdx)
//   - preco_unit_centavos que o fornecedor já definiu é preservado por lid
//   - histórico em pedidos_assistente_edicoes (antes/depois + resumo)
//   - aviso cruzado via avisoOficial (texto na janela de 24h, senão template)
// ============================================================================

import { randomUUID } from 'crypto'
import { supabaseAdmin } from './supabase-server'
import { avisoOficial } from './whatsapp-notify'
import { primeiroNome } from './nome'
import type { LinhaPedido } from './pedido-assistente-oferta'

export type AutorEdicao = 'cliente' | 'fornecedor' | 'admin'

/** Linha como chega do editor do fornecedor: mesma forma + índice de origem. */
export type LinhaEditada = LinhaPedido & {
  publico?: string | null
  estampado?: boolean | null
  acabamentos?: string[] | null
  categoria?: string | null
  objetivo_material?: string | null
  /** Posição da linha no pedido ANTES da edição (null = linha nova). */
  origIdx?: number | null
}

type MapaMockups = Record<string, unknown>

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

function normalizarLinha(raw: LinhaEditada, anterior: LinhaPedido | null): LinhaPedido & { origIdx: number | null } {
  const tamanhos = Array.isArray(raw.tamanhos)
    ? raw.tamanhos
        .map((t) => ({ tamanho: str(t?.tamanho), qtd: Number.isFinite(Number(t?.qtd)) && Number(t?.qtd) > 0 ? Math.round(Number(t?.qtd)) : null }))
        .filter((t) => t.tamanho)
    : []
  const somaTam = tamanhos.reduce((s, t) => s + (t.qtd ?? 0), 0)
  const totalRaw = Number.isFinite(Number(raw.total)) && Number(raw.total) > 0 ? Math.round(Number(raw.total)) : null
  // Com grade preenchida, o total é a soma da grade; sem grade, vale o total digitado.
  const total = somaTam > 0 ? somaTam : totalRaw

  const out: LinhaPedido & { origIdx: number | null } = {
    lid: str(raw.lid) ?? anterior?.lid ?? randomUUID(),
    modelo: str(raw.modelo),
    cor: str(raw.cor),
    material: str(raw.material),
    total,
    tamanhos,
    estampas: Array.isArray(raw.estampas) ? raw.estampas : anterior?.estampas ?? [],
    descricao: str(raw.descricao),
    // Preço já definido pelo fornecedor sobrevive a edições de texto/grade —
    // é ele quem reabre o orçamento se quiser mudar.
    preco_unit_centavos:
      typeof raw.preco_unit_centavos === 'number' ? raw.preco_unit_centavos : anterior?.preco_unit_centavos ?? null,
    origIdx: typeof raw.origIdx === 'number' && raw.origIdx >= 0 ? raw.origIdx : null,
  }
  // Campos extras que o visualizador do cliente usa (não perdem no round-trip).
  // CONFIRMAÇÃO NÃO SOBREVIVE AO QUE ELA DESCREVE — 13/09/2026.
  //
  // `confirmado_pelo_cliente` isenta a linha das regras de cor/descrição da
  // revisão. Herdá-la como os outros extras a tornava WRITE-ONCE: não dava pra
  // limpar, e ela seguia colada na linha mesmo depois de a peça mudar. O cliente
  // troca pra 15 azul + 15 branca, o modelo ajusta `cor` e `total`, e a ficha vai
  // pra confecção dizendo "peça única bicolor" num pedido que virou dois.
  //
  // Então: mexeu em `cor` ou `descricao` sem reconfirmar, a confirmação CAI. É
  // determinístico e vale pros QUATRO escritores — o helper do agente, o editor
  // do fornecedor, o admin e o definirPecas — porque mora aqui, e não em quem
  // chama. Se a peça nova ainda for ambígua, a revisão recusa de novo e o modelo
  // reconfirma no mesmo turno; não depende de ninguém lembrar de limpar.
  const mudouOQueFoiConfirmado =
    anterior != null && (str(raw.cor) !== (str(anterior.cor) ?? null) || str(raw.descricao) !== (str(anterior.descricao) ?? null))
  out.confirmado_pelo_cliente =
    str(raw.confirmado_pelo_cliente) ?? (mudouOQueFoiConfirmado ? null : str(anterior?.confirmado_pelo_cliente) ?? null)

  const extras: Array<keyof LinhaEditada> = ['publico', 'estampado', 'acabamentos', 'categoria', 'objetivo_material']
  for (const k of extras) {
    const v = raw[k] !== undefined ? raw[k] : (anterior as LinhaEditada | null)?.[k]
    if (v !== undefined) (out as Record<string, unknown>)[k] = v
  }
  return out
}

function descreverLinha(l: LinhaPedido): string {
  return [l.total ? `${l.total}×` : null, l.modelo || 'peça', l.cor ? `· ${l.cor}` : null].filter(Boolean).join(' ')
}

function gradeStr(l: LinhaPedido): string {
  return (l.tamanhos ?? []).map((t) => `${t.tamanho}:${t.qtd ?? 0}`).join(',')
}

/** Resumo humano do que mudou (pra WhatsApp e pro histórico). */
export function resumirDiffLinhas(antes: LinhaPedido[], depois: LinhaPedido[]): { resumo: string; lidsAlterados: string[]; mudou: boolean } {
  const porLid = new Map<string, LinhaPedido>()
  for (const l of antes) if (l.lid) porLid.set(l.lid, l)
  const partes: string[] = []
  const lids: string[] = []
  let mudou = false

  for (const l of depois) {
    const a = l.lid ? porLid.get(l.lid) : undefined
    if (!a) {
      partes.push(`+ ${descreverLinha(l)}`)
      if (l.lid) lids.push(l.lid)
      mudou = true
      continue
    }
    porLid.delete(l.lid!)
    const difs: string[] = []
    if ((a.modelo ?? '') !== (l.modelo ?? '')) difs.push('modelo')
    if ((a.cor ?? '') !== (l.cor ?? '')) difs.push('cor')
    if ((a.material ?? '') !== (l.material ?? '')) difs.push('material')
    if ((a.total ?? 0) !== (l.total ?? 0) || gradeStr(a) !== gradeStr(l)) difs.push('grade/quantidade')
    if ((a.descricao ?? '') !== (l.descricao ?? '')) difs.push('observação')
    if (difs.length) {
      partes.push(`~ ${descreverLinha(l)} (${difs.join(', ')})`)
      if (l.lid) lids.push(l.lid)
      mudou = true
    }
  }
  for (const a of porLid.values()) {
    partes.push(`− ${descreverLinha(a)}`)
    mudou = true
  }
  return { resumo: partes.join('\n'), lidsAlterados: lids, mudou }
}

/** Chave não-numérica: o PDF e o visualizador leem mockups[0], [1], … por
 *  POSIÇÃO, então nada aqui dentro é mostrado como foto de peça nenhuma. */
export const CHAVE_PENDENTES = 'pendentes'

/**
 * Re-mapeia o mapa de mockups (chave = índice da linha) pra nova ordem.
 * Linhas novas não têm mockup; linhas removidas perdem o mockup (era delas).
 *
 * `pendentes` atravessa: não é de posição nenhuma, então reordenar não mexe nele.
 */
function remapearMockups(mk: MapaMockups | null, novas: Array<{ origIdx: number | null }>): MapaMockups {
  if (!mk || typeof mk !== 'object') return {}
  const out: MapaMockups = {}
  novas.forEach((l, novoIdx) => {
    if (l.origIdx == null) return
    const v = mk[String(l.origIdx)]
    if (v !== undefined) out[String(novoIdx)] = v
  })
  const pend = mk[CHAVE_PENDENTES]
  if (pend !== undefined) out[CHAVE_PENDENTES] = pend
  return out
}

/**
 * FOTO DE CLIENTE NÃO MORRE NUMA TROCA DE LINHAS — 12/09/2026.
 *
 * `definirPecasPedido` substitui a lista inteira e monta toda linha com
 * `origIdx: null`. Como `remapearMockups` pula linha sem origIdx, o mapa voltava
 * VAZIO: definir as peças APAGAVA as fotos. O `20260900298` recebeu 9 imagens do
 * cliente e está hoje com `mockups: {}`.
 *
 * Isso é metade do "11 de 19 pedidos com zero foto": não era o anexo que faltava,
 * era o anexo sendo desfeito no passo seguinte.
 *
 * Por que PARK e não "põe na peça 1": o pedido nesse momento tem uma linha só, o
 * placeholder `cor: "a definir"` — e nos 5 pedidos medidos ele virou 2, 2, 1, 11 e
 * 2 peças. Empurrar as fotos pra primeira peça é apostar que a foto é da primeira
 * das onze, e foto na peça errada faz a confecção produzir errado: é pior que foto
 * faltando, porque ninguém percebe. Então os bytes ficam guardados, sem afirmar
 * peça, e quem atribui é quem sabe.
 */
function comFotosParqueadas(
  anterior: MapaMockups | null,
  novo: MapaMockups,
  novas: Array<{ origIdx: number | null }>
): MapaMockups {
  if (!anterior || typeof anterior !== 'object') return novo
  // SÓ na troca da lista inteira (toda linha sem origIdx), que é o que
  // `definirPecasPedido` faz. Fornecedor que APAGA uma peça continua apagando as
  // fotos dela: ali sumir é a intenção, não o acidente — e parquear viraria foto
  // de peça excluída voltando pro pedido depois.
  if (novas.length === 0 || novas.some((l) => l.origIdx != null)) return novo
  const jaTem = new Set<string>()
  for (const v of Object.values(novo)) {
    const fotos = (v as { fotos?: unknown })?.fotos
    if (Array.isArray(fotos)) for (const f of fotos) if (typeof f === 'string') jaTem.add(f)
  }
  const parque: string[] = []
  for (const [k, v] of Object.entries(anterior)) {
    if (k === CHAVE_PENDENTES) continue
    const fotos = (v as { fotos?: unknown })?.fotos
    if (!Array.isArray(fotos)) continue
    for (const f of fotos) if (typeof f === 'string' && !jaTem.has(f) && !parque.includes(f)) parque.push(f)
  }
  const pendAntes = anterior[CHAVE_PENDENTES] as { fotos?: unknown; de?: unknown } | undefined
  const herdadas = Array.isArray(pendAntes?.fotos) ? pendAntes.fotos.filter((f): f is string => typeof f === 'string') : []
  const todas = [...herdadas, ...parque].filter((f) => !jaTem.has(f))
  if (todas.length === 0) return novo
  // `de` diz de qual wa_mensagens veio cada foto. Reconstruir `pendentes` só com
  // `fotos` apagaria isso na primeira troca de lista, e "veio do backfill" e "o
  // cliente mandou agora" voltariam a ser indistinguíveis.
  const de = pendAntes?.de && typeof pendAntes.de === 'object' ? pendAntes.de : undefined
  return { ...novo, [CHAVE_PENDENTES]: de ? { fotos: todas, de } : { fotos: todas } }
}

export type ResultadoEdicao =
  | { ok: true; linhas: LinhaPedido[]; resumo: string; mudou: boolean; orcamentoReaberto: boolean }
  | { ok: false; erro: string; status: number }

/**
 * Grava as linhas editadas pelo FORNECEDOR (com origIdx) ou pelo admin,
 * cuidando de lid, mockups, preço, orçamento e histórico. Não avisa ninguém —
 * quem chama decide (ver avisarClienteEdicaoFornecedor).
 */
export async function salvarLinhasEditadas(params: {
  pedidoId: string
  linhas: LinhaEditada[]
  autor: AutorEdicao
  fornecedorId?: string | null
  ofertaId?: string | null
}): Promise<ResultadoEdicao> {
  const { data: ped } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, linhas, mockups, status, orcamento_status, pagamento_status')
    .eq('id', params.pedidoId)
    .maybeSingle<{ id: string; linhas: LinhaPedido[] | null; mockups: MapaMockups | null; status: string | null; orcamento_status: string | null; pagamento_status: string | null }>()
  if (!ped) return { ok: false, erro: 'Pedido não encontrado', status: 404 }
  if (ped.pagamento_status === 'pago') return { ok: false, erro: 'Pedido já pago — não dá mais pra alterar os produtos.', status: 409 }
  if (ped.status === 'cancelado') return { ok: false, erro: 'Pedido cancelado.', status: 409 }

  const antes: LinhaPedido[] = Array.isArray(ped.linhas) ? ped.linhas : []
  const novas = params.linhas
    .map((raw) => normalizarLinha(raw, raw.origIdx != null ? antes[raw.origIdx] ?? null : null))
    .filter((l) => l.modelo || l.cor || (l.total ?? 0) > 0 || (l.tamanhos?.length ?? 0) > 0)
  if (novas.length === 0) return { ok: false, erro: 'O pedido precisa ter pelo menos um produto.', status: 400 }

  const linhasFinais: LinhaPedido[] = novas.map((l) => { const { origIdx, ...resto } = l; void origIdx; return resto })
  const diff = resumirDiffLinhas(antes, linhasFinais)
  const orcamentoReaberto = diff.mudou && ped.orcamento_status === 'definido'

  const patch: Record<string, unknown> = {
    linhas: linhasFinais,
    mockups: comFotosParqueadas(ped.mockups, remapearMockups(ped.mockups, novas), novas),
    atualizado_em: new Date().toISOString(),
  }
  if (orcamentoReaberto) patch.orcamento_status = 'aguardando_fornecedor'

  const { error } = await supabaseAdmin.from('pedidos_assistente').update(patch).eq('id', params.pedidoId)
  if (error) return { ok: false, erro: error.message, status: 500 }

  if (diff.mudou) {
    try {
      await supabaseAdmin.from('pedidos_assistente_edicoes').insert({
        pedido_id: params.pedidoId,
        autor: params.autor,
        fornecedor_id: params.fornecedorId ?? null,
        oferta_id: params.ofertaId ?? null,
        resumo: diff.resumo.slice(0, 2000),
        linhas_antes: antes,
        linhas_depois: linhasFinais,
      })
    } catch (err) {
      console.error('[pedido-linhas] histórico falhou', { err })
    }
  }
  return { ok: true, linhas: linhasFinais, resumo: diff.resumo, mudou: diff.mudou, orcamentoReaberto }
}

/**
 * Histórico + aviso ao FORNECEDOR quando o CLIENTE edita pelo visualizador.
 * O PATCH do cliente já gravou as linhas; aqui só comparamos e avisamos se
 * houver oferta aceita. Failure-soft.
 */
export async function registrarEdicaoCliente(pedidoId: string, antes: LinhaPedido[], depois: LinhaPedido[]): Promise<void> {
  try {
    const diff = resumirDiffLinhas(antes, depois)
    if (!diff.mudou) return
    await supabaseAdmin.from('pedidos_assistente_edicoes').insert({
      pedido_id: pedidoId,
      autor: 'cliente',
      resumo: diff.resumo.slice(0, 2000),
      linhas_antes: antes,
      linhas_depois: depois,
    })
    const { data: oferta } = await supabaseAdmin
      .from('ofertas_pedido_assistente')
      .select('id, leads_fornecedores(nome, whatsapp)')
      .eq('pedido_id', pedidoId)
      .eq('status', 'aceita')
      .maybeSingle<{ id: string; leads_fornecedores: { nome: string | null; whatsapp: string | null } | null }>()
    const tel = oferta?.leads_fornecedores?.whatsapp
    if (!oferta || !tel) return
    const { data: ped } = await supabaseAdmin.from('pedidos_assistente').select('codigo, nome').eq('id', pedidoId).maybeSingle<{ codigo: string | null; nome: string | null }>()
    const cliente = primeiroNome(ped?.nome ?? '') || 'O cliente'
    const cod = ped?.codigo ? ` nº ${ped.codigo}` : ''
    await avisoOficial({
      telefone: tel,
      nome: oferta.leads_fornecedores?.nome ?? null,
      texto: `${cliente} ajustou o pedido${cod} na Confeccione:\n${diff.resumo}\n\nConfira antes de orçar/produzir:\nhttps://www.confeccione.com.br/fornecedor/oferta/${oferta.id}`,
      resumo: `${cliente} ajustou os produtos do pedido${cod} — confira antes de orçar`,
      caminhoBotao: `fornecedor/oferta/${oferta.id}`,
    })
  } catch (err) {
    console.error('[pedido-linhas] registrarEdicaoCliente falhou', { err })
  }
}

/** Aviso ao CLIENTE quando o FORNECEDOR edita pela página da oferta. Failure-soft. */
export async function avisarClienteEdicaoFornecedor(params: {
  pedidoId: string
  fornecedorNome: string | null
  resumo: string
  orcamentoReaberto: boolean
}): Promise<boolean> {
  try {
    const { data: ped } = await supabaseAdmin
      .from('pedidos_assistente')
      .select('nome, telefone, codigo')
      .eq('id', params.pedidoId)
      .maybeSingle<{ nome: string | null; telefone: string | null; codigo: string | null }>()
    if (!ped?.telefone) return false
    const forn = (params.fornecedorNome ?? '').trim() || 'O fornecedor'
    const cod = ped.codigo ? ` nº ${ped.codigo}` : ''
    const rodape = params.orcamentoReaberto ? '\n\nO orçamento anterior foi cancelado — você recebe o novo valor assim que o fornecedor reenviar.' : ''
    return await avisoOficial({
      telefone: ped.telefone,
      nome: ped.nome,
      texto: `${forn} ajustou o seu pedido${cod}:\n${params.resumo}${rodape}\n\nVeja como ficou e, se não concordar, fale com eles ou com a gente:\nhttps://www.confeccione.com.br/visualizador/${params.pedidoId}`,
      resumo: `${forn} ajustou os produtos do seu pedido${cod} — veja como ficou`,
      caminhoBotao: `visualizador/${params.pedidoId}`,
    })
  } catch (err) {
    console.error('[pedido-linhas] avisarClienteEdicaoFornecedor falhou', { err })
    return false
  }
}

/**
 * Edição pedida pelo CLIENTE na conversa do WhatsApp (Luigi).
 *
 * POR QUE ISTO EXISTE
 * Até 09/09/2026 o cliente só editava pelo visualizador. Quando ele pedia a
 * troca por mensagem — "pode trocar o pima por algodão penteado 30/1" — o
 * Luigi não tinha como fazer e respondia "alguém da equipe já ajusta", o que
 * na prática significava que ninguém ajustava. Aqui o pedido dele vira ação.
 *
 * Passa pelas mesmas travas do visualizador (pago não altera, cancelado não
 * altera, orçamento definido volta a aguardar o fornecedor) e avisa o
 * fornecedor que aceitou — sem isso ele produziria com a informação velha.
 */
export async function editarLinhasPedidoCliente(params: {
  pedidoId: string
  linhas: LinhaEditada[]
}): Promise<ResultadoEdicao> {
  const { data: antesData } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('linhas')
    .eq('id', params.pedidoId)
    .maybeSingle<{ linhas: LinhaPedido[] | null }>()
  const antes: LinhaPedido[] = Array.isArray(antesData?.linhas) ? antesData.linhas : []

  const r = await salvarLinhasEditadas({ pedidoId: params.pedidoId, linhas: params.linhas, autor: 'cliente' })
  if (!r.ok) return r

  // NADA GRAVADO NÃO É SUCESSO — 12/09/2026.
  //
  // Até hoje isto devolvia `ok: true, mudou: false` quando a edição não mexia
  // em nada. O agente lê `ok` e anuncia: no pedido 20260900302 o cliente pediu
  // 50 peças, a gravação caiu fora por um campo que a ferramenta descartava, e
  // o Luigi respondeu "Atualizado: 50 jaquetões" com 40 no banco. Falha que se
  // parece com sucesso, dita na cara do cliente.
  //
  // A trava é aqui, e não no prompt, porque a classe é maior que aquele campo:
  // qualquer campo que alguém esqueça de mapear amanhã volta a dar "nada
  // mudou". Enquanto isto for erro, o agente não tem como anunciar a mudança.
  //
  // Empate legítimo (o cliente pediu o que já está lá) também cai aqui, e é o
  // comportamento certo: "já está assim" é a resposta verdadeira, "atualizei"
  // não é.
  if (!r.mudou) {
    return {
      ok: false,
      erro:
        'nada foi gravado: a peça já está exatamente assim. NÃO diga que alterou. ' +
        'Confira o que ele pediu contra o que já está no pedido: se for igual, diga que já está assim; ' +
        'se for diferente, o campo certo não foi mandado — mande de novo com ele.',
      status: 409,
    }
  }

  // Avisa o fornecedor que aceitou. Failure-soft: o aviso não pode desfazer a
  // edição que já valeu — a mesma regra do resto do módulo.
  void registrarEdicaoClienteAviso(params.pedidoId, antes, r.linhas).catch((err) =>
    console.error('[pedido-linhas] aviso ao fornecedor falhou', { err })
  )
  return r
}

/** O que `ajustar_peca_pedido` muda numa peça. Os dois agentes mandam isto. */
export type AjusteDeLinha = {
  material?: string | null
  modelo?: string | null
  cor?: string | null
  quantidade?: number | null
  descricao?: string | null
  tamanhos?: Array<{ tamanho: string; qtd: number }> | null
  /** Ver LinhaPedido.confirmado_pelo_cliente. Isenta ESTA linha das regras 1 e 2. */
  confirmado_pelo_cliente?: string | null
}

/** Grade como as ferramentas dos agentes mandam: [{tamanho, qtd}]. */
export function gradeDaFerramenta(v: unknown): Array<{ tamanho: string; qtd: number }> | null {
  if (!Array.isArray(v)) return null
  const out = (v as Array<Record<string, unknown>>)
    .map((t) => ({ tamanho: str(t?.tamanho) ?? '', qtd: Number(t?.qtd) }))
    .filter((t) => t.tamanho.length > 0 && Number.isFinite(t.qtd) && t.qtd > 0)
    .map((t) => ({ tamanho: t.tamanho, qtd: Math.round(t.qtd) }))
  return out.length > 0 ? out : null
}

/**
 * Aplica o ajuste de UMA peça e devolve a lista inteira pronta pra
 * editarLinhasPedidoCliente — origIdx em todas, pra preservar lid, preço do
 * fornecedor e a posição dos mockups.
 *
 * A GRADE MANDA NO TOTAL, E MUDAR SÓ O TOTAL É RECUSADO — 12/09/2026.
 *
 * Pedido 20260900302: o cliente pediu 50, o modelo chamou a ferramenta com
 * quantidade 50 E a grade nova, e o pedido ficou em 40. Duas coisas somadas:
 * `tamanhos` não existia no schema, então sobrava a grade velha (10/10/10/10)
 * na linha; e `normalizarLinha` faz `total = soma da grade` sempre que há
 * grade. O 50 era descartado no caminho, o diff dava "nada mudou", e o Luigi
 * anunciou "Atualizado: 50 jaquetões" com 40 gravado.
 *
 * Agora a grade entra. E quantidade sem grade numa peça que TEM grade estoura:
 * aceitar seria escolher em silêncio entre dois números que o cliente deu — e o
 * silêncio é o que fez este bug custar uma mentira pro cliente. Quem tem que
 * desempatar é ele, perguntado.
 *
 * Vive aqui, e não nos dois handlers, porque a regra é uma só e os agentes são
 * dois: a cópia que ficasse pra trás seria exatamente o buraco de novo.
 */
export function linhasComAjuste(atuais: LinhaPedido[], posicao: number, ajuste: AjusteDeLinha): LinhaEditada[] {
  const alvo = atuais[posicao - 1]
  const gradeAtual = (alvo?.tamanhos ?? []).filter((t) => str(t?.tamanho))
  const gradeNova = ajuste.tamanhos ?? null

  if (ajuste.quantidade != null && !gradeNova && gradeAtual.length > 0) {
    const comoEsta = gradeAtual.map((t) => `${t.tamanho}:${t.qtd ?? 0}`).join(', ')
    throw new Error(
      `essa peça tem grade de tamanhos (${comoEsta}) e é a soma da grade que vale como total. ` +
        `Mudar só a quantidade não grava nada. Pergunte a ele como fica a grade nova somando ` +
        `${ajuste.quantidade} e chame de novo mandando tamanhos junto.`
    )
  }

  return atuais.map((l, i) => {
    const base: LinhaEditada = { ...l, origIdx: i }
    if (i !== posicao - 1) return base
    return {
      ...base,
      material: ajuste.material ?? l.material,
      modelo: ajuste.modelo ?? l.modelo,
      cor: ajuste.cor ?? l.cor,
      total: ajuste.quantidade ?? l.total,
      descricao: ajuste.descricao ?? l.descricao,
      tamanhos: gradeNova ?? l.tamanhos,
      // SÓ o que o modelo mandou. Herdar aqui carregaria o valor antigo pra
      // frente e normalizarLinha nunca veria a ausência — a queda nunca
      // dispararia. Quem herda é um só, e é lá, que tem a linha anterior.
      confirmado_pelo_cliente: ajuste.confirmado_pelo_cliente ?? null,
    }
  })
}

/** Só o aviso ao fornecedor (o histórico já foi gravado por salvarLinhasEditadas). */
async function registrarEdicaoClienteAviso(pedidoId: string, antes: LinhaPedido[], depois: LinhaPedido[]): Promise<void> {
  const diff = resumirDiffLinhas(antes, depois)
  if (!diff.mudou) return
  const { data: oferta } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('id, leads_fornecedores(nome, whatsapp)')
    .eq('pedido_id', pedidoId)
    .eq('status', 'aceita')
    .maybeSingle<{ id: string; leads_fornecedores: { nome: string | null; whatsapp: string | null } | null }>()
  const tel = oferta?.leads_fornecedores?.whatsapp
  if (!oferta || !tel) return
  const { data: ped } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('codigo, nome')
    .eq('id', pedidoId)
    .maybeSingle<{ codigo: string | null; nome: string | null }>()
  const cliente = primeiroNome(ped?.nome ?? '') || 'O cliente'
  const cod = ped?.codigo ? ` nº ${ped.codigo}` : ''
  await avisoOficial({
    telefone: tel,
    nome: oferta.leads_fornecedores?.nome ?? null,
    texto: `${cliente} ajustou o pedido${cod} na Confeccione:\n${diff.resumo}\n\nConfira antes de orçar/produzir:\nhttps://www.confeccione.com.br/fornecedor/oferta/${oferta.id}`,
    resumo: `${cliente} ajustou os produtos do pedido${cod} — confira antes de orçar`,
    caminhoBotao: `fornecedor/oferta/${oferta.id}`,
  })
}

/** Última edição feita pelo fornecedor (pro selo no visualizador do cliente). */
export async function ultimaEdicaoFornecedor(pedidoId: string): Promise<{ em: string; resumo: string | null; lids: string[] } | null> {
  const { data } = await supabaseAdmin
    .from('pedidos_assistente_edicoes')
    .select('criado_em, resumo, linhas_antes, linhas_depois')
    .eq('pedido_id', pedidoId)
    .eq('autor', 'fornecedor')
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle<{ criado_em: string; resumo: string | null; linhas_antes: LinhaPedido[]; linhas_depois: LinhaPedido[] }>()
  if (!data) return null
  const diff = resumirDiffLinhas(data.linhas_antes ?? [], data.linhas_depois ?? [])
  return { em: data.criado_em, resumo: data.resumo, lids: diff.lidsAlterados }
}
