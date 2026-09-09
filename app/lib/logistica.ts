// app/lib/logistica.ts
// ============================================================================
// LOGÍSTICA PRÓPRIA — parceiros e demandas de coleta (09/09/2026)
//
// Isto NÃO é o frete do pedido do cliente (esse é o Melhor Envio, em
// melhorenvio.ts). Aqui é a operação da casa: buscar malha em Caruaru, levar
// peça pra estamparia, trazer material pro escritório.
//
// POR QUE NÃO TEM API
// A pergunta do Fernando era se dava pra usar 99 ou BlaBlaCar. Não dá: a 99 não
// expõe API de corrida, o BlaBlaCar é carona de passageiro e nenhum dos dois
// atende os 130 km de Caruaru ao Recife. Essa rota é bagageiro, van e
// transportadora regional — e isso se resolve conversando no WhatsApp.
//
// Então o "sistema de logística" aqui é: uma agenda de quem faz a rota, e o
// agente cotando com eles pelo mesmo caminho de mensagem que já existe (com as
// travas de spam de hoje). O valor não está na integração, está em nunca mais
// perguntar "quem mesmo trouxe a última carga e quanto cobrou".
// ============================================================================

import { supabaseAdmin } from './supabase-server'

export type TipoParceiro = 'transporte' | 'malha' | 'aviamento' | 'estamparia' | 'bordado' | 'servico' | 'outro'

export type Parceiro = {
  id: string
  tipo: TipoParceiro
  nome: string
  contato_nome: string | null
  whatsapp: string | null
  cidade: string | null
  uf: string | null
  rotas: string[]
  fornece: string | null
  observacao: string | null
}

const COLUNAS = 'id, tipo, nome, contato_nome, whatsapp, cidade, uf, rotas, fornece, observacao'

/**
 * Acha parceiro por nome, tipo, cidade, rota ou o que ele fornece.
 *
 * Uma busca só em vez de três ferramentas: quem pergunta "quem traz de Caruaru"
 * e quem pergunta "onde a gente compra malha" está fazendo a mesma pergunta —
 * "a quem eu recorro pra isso" — e o agente não deveria ter que escolher a
 * ferramenta certa antes de saber a resposta.
 */
export async function buscarParceiros(params: {
  texto?: string | null
  tipo?: TipoParceiro | null
  rota?: string | null
  limite?: number
}): Promise<Parceiro[]> {
  let q = supabaseAdmin.from('parceiros').select(COLUNAS).eq('ativo', true).limit(params.limite ?? 20)

  if (params.tipo) q = q.eq('tipo', params.tipo)
  if (params.rota) q = q.contains('rotas', [params.rota])

  const texto = params.texto?.trim()
  if (texto) {
    const t = `%${texto}%`
    q = q.or(`nome.ilike.${t},contato_nome.ilike.${t},fornece.ilike.${t},cidade.ilike.${t},observacao.ilike.${t}`)
  }

  const { data, error } = await q.order('nome')
  if (error) throw new Error(`buscar parceiros: ${error.message}`)
  return (data ?? []) as Parceiro[]
}

export type Demanda = {
  id: string
  descricao: string
  origem_texto: string | null
  destino_texto: string | null
  precisa_ate: string | null
  status: string
  valor_centavos: number | null
  observacao: string | null
  criado_em: string
}

export async function abrirDemanda(d: {
  descricao: string
  origemParceiroId?: string | null
  origemTexto?: string | null
  destinoTexto?: string | null
  precisaAte?: string | null
  observacao?: string | null
}): Promise<Demanda> {
  const { data, error } = await supabaseAdmin
    .from('demandas_logistica')
    .insert({
      descricao: d.descricao,
      origem_parceiro_id: d.origemParceiroId ?? null,
      origem_texto: d.origemTexto ?? null,
      destino_texto: d.destinoTexto ?? null,
      precisa_ate: d.precisaAte ?? null,
      observacao: d.observacao ?? null,
    })
    .select('id, descricao, origem_texto, destino_texto, precisa_ate, status, valor_centavos, observacao, criado_em')
    .single<Demanda>()
  if (error) throw new Error(`abrir demanda: ${error.message}`)
  return data
}

export async function listarDemandas(status?: string | null): Promise<Demanda[]> {
  let q = supabaseAdmin
    .from('demandas_logistica')
    .select('id, descricao, origem_texto, destino_texto, precisa_ate, status, valor_centavos, observacao, criado_em')
    .order('criado_em', { ascending: false })
    .limit(30)
  if (status) q = q.eq('status', status)
  const { data, error } = await q
  if (error) throw new Error(`listar demandas: ${error.message}`)
  return (data ?? []) as Demanda[]
}

/**
 * Fecha a demanda com quem levou e por quanto.
 *
 * O valor é o que transforma isto em memória útil: sem ele, daqui a três meses
 * "quanto custa Caruaru-Recife" volta a ser uma pergunta pro WhatsApp.
 */
export async function fecharDemanda(d: {
  demandaId: string
  transportadorId?: string | null
  valorCentavos?: number | null
  status: 'contratada' | 'concluida' | 'cancelada'
  observacao?: string | null
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from('demandas_logistica')
    .update({
      status: d.status,
      transportador_id: d.transportadorId ?? null,
      valor_centavos: d.valorCentavos ?? null,
      ...(d.observacao ? { observacao: d.observacao } : {}),
      atualizado_em: new Date().toISOString(),
    })
    .eq('id', d.demandaId)
  if (error) throw new Error(`fechar demanda: ${error.message}`)
}

/**
 * O que já se pagou nas últimas coletas — a resposta pra "está caro?".
 *
 * Sem filtro por rota de propósito: hoje a demanda guarda origem e destino em
 * texto livre, e casar "Caruaru/PE" com "PE-095 KM 79, Caruaru" por string daria
 * uma comparação que erra em silêncio. Com dez linhas na tela, quem lê separa
 * as rotas melhor do que um LIKE. Quando houver volume que justifique, o certo
 * é gravar a rota como campo, não adivinhar do texto.
 */
export async function historicoDeCustos(): Promise<
  Array<{ quando: string; valorCentavos: number | null; quem: string | null; origem: string | null; destino: string | null }>
> {
  const { data } = await supabaseAdmin
    .from('demandas_logistica')
    .select('criado_em, valor_centavos, origem_texto, destino_texto, transportador_id')
    .eq('status', 'concluida')
    .not('valor_centavos', 'is', null)
    .order('criado_em', { ascending: false })
    .limit(10)

  const linhas = (data ?? []) as Array<{
    criado_em: string
    valor_centavos: number | null
    origem_texto: string | null
    destino_texto: string | null
    transportador_id: string | null
  }>
  if (linhas.length === 0) return []

  const ids = [...new Set(linhas.map((l) => l.transportador_id).filter((i): i is string => Boolean(i)))]
  const nomes = new Map<string, string>()
  if (ids.length > 0) {
    const { data: ps } = await supabaseAdmin.from('parceiros').select('id, nome').in('id', ids)
    for (const p of (ps ?? []) as Array<{ id: string; nome: string }>) nomes.set(p.id, p.nome)
  }

  return linhas.map((l) => ({
    quando: l.criado_em,
    valorCentavos: l.valor_centavos,
    quem: l.transportador_id ? (nomes.get(l.transportador_id) ?? null) : null,
    origem: l.origem_texto,
    destino: l.destino_texto,
  }))
}
