// app/lib/gestao-consulta.ts
// ============================================================================
// CONSULTAS DE LEITURA DO AGENTE DE GESTÃO (09/09/2026).
//
// POR QUE ISTO EXISTE
// O agente sabia listar filas e etapas, mas não sabia responder a coisa mais
// natural do mundo: "o André". Quando o Fernando citava alguém pelo nome, ele
// pedia o telefone de volta — tinha os números da operação, mas não conseguia
// ir de pessoa a contexto. Aqui ele ganha o caminho: achar quem é, ler o que
// foi conversado e abrir o pedido por inteiro.
//
// TUDO AQUI É SÓ LEITURA. Nada grava, nada envia.
//
// NONO DÍGITO: as buscas por telefone usam os últimos 8 dígitos, que não mudam
// com DDI, com o 9 do celular nem com formatação — pelo mesmo motivo explicado
// em whatsapp-notify.ts. Um contato pode aparecer em duas versões do número; a
// consulta junta as duas em vez de escolher uma e mentir por omissão.
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import { COLUNAS_ETAPA, type PedidoEtapa } from './etapas-pedido'

export type ContatoEncontrado = {
  nome: string | null
  telefone: string
  papel: 'cliente' | 'fornecedor' | 'desconhecido'
  ultima_mensagem_em: string | null
  ultima_mensagem: string | null
  luigi_chamou: boolean
  pedidos: Array<{ codigo: string | null; etapa: string; valor_centavos: number | null; desde: string }>
}

/**
 * Acha pessoas por parte do nome ou por telefone. Devolve o que o agente
 * precisa pra agir em seguida: telefone (pra preparar_mensagem), papel, o que
 * foi dito por último e os pedidos da pessoa.
 *
 * Busca por nome é ilike parcial de propósito: o Fernando escreve "andré",
 * "Andre Filipe" ou "jj camisetas", e o nome no banco vem do perfil do
 * WhatsApp, que raramente bate exato.
 */
export async function buscarContato(termo: string, limite = 5): Promise<ContatoEncontrado[]> {
  const t = termo.trim()
  if (t.length < 2) return []

  const digitos = t.replace(/\D/g, '')
  const porTelefone = digitos.length >= 8

  const { data: contatos } = await supabaseAdmin
    .from('wa_contatos')
    .select('id, wa_id, nome, cliente_id, fornecedor_id')
    .or(porTelefone ? `wa_id.like.%${digitos.slice(-8)}` : `nome.ilike.%${t}%`)
    .limit(limite * 2)

  const achados = (contatos ?? []) as Array<{
    id: string
    wa_id: string
    nome: string | null
    cliente_id: string | null
    fornecedor_id: string | null
  }>
  if (achados.length === 0) return []

  // Agrupa as versões do mesmo número (com e sem o nono dígito) numa pessoa só.
  const porTel8 = new Map<string, typeof achados>()
  for (const c of achados) {
    const k = c.wa_id.replace(/\D/g, '').slice(-8)
    porTel8.set(k, [...(porTel8.get(k) ?? []), c])
  }

  const saida: ContatoEncontrado[] = []
  for (const [tel8, grupo] of [...porTel8].slice(0, limite)) {
    const ids = grupo.map((c) => c.id)

    const { data: conversas } = await supabaseAdmin.from('wa_conversas').select('id, luigi_escalado_em').in('contato_id', ids)
    const conversaIds = (conversas ?? []).map((c) => c.id as string)

    type UltimaMsg = { corpo: string | null; criado_em: string }
    let ultima: UltimaMsg | null = null
    if (conversaIds.length > 0) {
      const { data } = await supabaseAdmin
        .from('wa_mensagens')
        .select('corpo, criado_em')
        .in('conversa_id', conversaIds)
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle<UltimaMsg>()
      ultima = data ?? null
    }

    const { data: pedidos } = await supabaseAdmin
      .from('pedidos_assistente_etapas')
      .select(COLUNAS_ETAPA)
      .like('telefone', `%${tel8}`)
      .order('criado_em', { ascending: false })
      .limit(10)
      .returns<PedidoEtapa[]>()

    const comNome = grupo.find((c) => c.nome) ?? grupo[0]
    saida.push({
      nome: comNome.nome,
      // O número mais longo é o que tem o nono dígito — é o que a Cloud API aceita melhor.
      telefone: grupo.map((c) => c.wa_id).sort((a, b) => b.length - a.length)[0],
      papel: grupo.some((c) => c.fornecedor_id) ? 'fornecedor' : grupo.some((c) => c.cliente_id) ? 'cliente' : 'desconhecido',
      ultima_mensagem_em: ultima?.criado_em ?? null,
      ultima_mensagem: ultima?.corpo ?? null,
      luigi_chamou: (conversas ?? []).some((c) => c.luigi_escalado_em),
      pedidos: (pedidos ?? []).map((p) => ({
        codigo: p.codigo,
        etapa: p.etapa,
        valor_centavos: p.valor_centavos,
        desde: p.desde,
      })),
    })
  }
  return saida
}

/**
 * O pedido por inteiro: quem é o cliente, em que etapa está, valores e — o que
 * mais faltava — AS PEÇAS, com modelo, tecido, cor e quantidade.
 *
 * Sem isto o agente sabia listar códigos e etapas mas não sabia dizer o que o
 * cliente tinha pedido; em 09/09/2026 ele respondeu "não sei o conteúdo do
 * pedido só com o que tenho aqui", que era verdade e era um buraco nosso.
 */
export async function detalhePedido(pedidoId: string) {
  const { data: p } = await supabaseAdmin
    .from('pedidos_assistente_etapas')
    .select(COLUNAS_ETAPA)
    .eq('id', pedidoId)
    .maybeSingle<PedidoEtapa>()
  if (!p) return null

  const { data: bruto } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('linhas, prazo_dias, observacoes, orcamento_status, pagamento_status')
    .eq('id', pedidoId)
    .maybeSingle<{
      linhas: Array<Record<string, unknown>> | null
      prazo_dias: number | null
      observacoes: string | null
      orcamento_status: string | null
      pagamento_status: string | null
    }>()

  const linhas = Array.isArray(bruto?.linhas) ? bruto.linhas : []

  const { data: ofertas } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('status, criado_em, valor_repasse_centavos, leads_fornecedores(nome)')
    .eq('pedido_id', pedidoId)
    .order('criado_em', { ascending: false })
    .limit(5)

  return {
    codigo: p.codigo,
    cliente: p.nome,
    telefone: p.telefone,
    uf: p.uf,
    etapa: p.etapa,
    desde: p.desde,
    valor_centavos: p.valor_centavos,
    orcamento_status: bruto?.orcamento_status ?? null,
    pagamento_status: bruto?.pagamento_status ?? null,
    prazo_dias: bruto?.prazo_dias ?? null,
    observacoes: bruto?.observacoes ?? null,
    motivo_parada: p.motivo_parada,
    // Posição é o que o Luigi usa em ajustar_peca_pedido — devolver numerado
    // evita que o agente e ele falem de peças diferentes.
    pecas: linhas.map((l, i) => ({
      posicao: i + 1,
      modelo: l.modelo ?? null,
      material: l.material ?? null,
      cor: l.cor ?? null,
      quantidade: l.total ?? null,
      descricao: l.descricao ?? null,
    })),
    ofertas: (ofertas ?? []).map((o) => {
      const f = o.leads_fornecedores as { nome: string | null } | { nome: string | null }[] | null
      return {
        fornecedor: (Array.isArray(f) ? f[0]?.nome : f?.nome) ?? null,
        status: o.status,
        em: o.criado_em,
        repasse_centavos: o.valor_repasse_centavos,
      }
    }),
  }
}

/**
 * As últimas mensagens trocadas com um número, das duas conversas quando o
 * contato está duplicado — em ordem cronológica, pra o agente ler como conversa.
 */
export async function lerConversa(telefone: string, limite = 30): Promise<Array<{ quem: string; texto: string; em: string }>> {
  const tel8 = telefone.replace(/\D/g, '').slice(-8)
  if (tel8.length < 8) return []

  const { data: contatos } = await supabaseAdmin.from('wa_contatos').select('id').like('wa_id', `%${tel8}`)
  const ids = (contatos ?? []).map((c) => c.id as string)
  if (ids.length === 0) return []

  const { data: conversas } = await supabaseAdmin.from('wa_conversas').select('id').in('contato_id', ids)
  const conversaIds = (conversas ?? []).map((c) => c.id as string)
  if (conversaIds.length === 0) return []

  const { data: msgs } = await supabaseAdmin
    .from('wa_mensagens')
    .select('direcao, corpo, tipo, autor, criado_em')
    .in('conversa_id', conversaIds)
    .order('criado_em', { ascending: false })
    .limit(Math.min(limite, 100))

  return ((msgs ?? []) as Array<{ direcao: string; corpo: string | null; tipo: string; autor: string | null; criado_em: string }>)
    .reverse()
    .map((m) => ({
      quem:
        m.direcao === 'entrada'
          ? 'contato'
          : m.autor === 'luigi'
            ? 'Luigi'
            : m.autor === 'mcp'
              ? 'assistente'
              : m.autor === 'gestao'
                ? 'agente'
                : 'equipe',
      texto: m.corpo?.trim() || `[${m.tipo}]`,
      em: m.criado_em,
    }))
}
