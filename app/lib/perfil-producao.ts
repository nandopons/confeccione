// app/lib/perfil-producao.ts
// ============================================================================
// O PERFIL DE PRODUÇÃO, PREENCHIDO CONVERSANDO (09/09/2026)
//
// O cadastro de fornecedor sabe pouco: tipo de peça, pedido mínimo, cidade.
// Com isso o match acerta a região e erra o que decide se ela pega o pedido —
// se fornece o tecido, se tem máquina pra malha, quanto aguenta no mês.
//
// Ninguém preenche formulário de 10 campos. Mas confecção responde no WhatsApp,
// porque é onde ela já trabalha o dia inteiro. Então o formulário virou
// conversa: o Luigi pergunta e grava o que ela responder, campo a campo.
//
// GRAVA PARCIAL DE PROPÓSITO. A conversa pode morrer na terceira pergunta —
// e três respostas gravadas melhoram o match mais do que zero. Por isso cada
// chamada faz merge do que veio, sem exigir o resto.
// ============================================================================

import { supabaseAdmin } from './supabase-server'

export type PerfilProducao = {
  fornecedor_id: string
  servicos: string[]
  tecidos: string[]
  maquinas: string[]
  fornece_material: boolean | null
  capacidade_mes: number | null
  aceita_encaixe: boolean | null
  faz_desenvolvimento: boolean | null
  nao_faz: string | null
  observacao: string | null
  respondido_em: string | null
}

const COLUNAS =
  'fornecedor_id, servicos, tecidos, maquinas, fornece_material, capacidade_mes, aceita_encaixe, faz_desenvolvimento, nao_faz, observacao, respondido_em'

export async function lerPerfil(fornecedorId: string): Promise<PerfilProducao | null> {
  const { data } = await supabaseAdmin
    .from('perfil_producao')
    .select(COLUNAS)
    .eq('fornecedor_id', fornecedorId)
    .maybeSingle<PerfilProducao>()
  return data
}

export type CamposPerfil = {
  servicos?: string[] | null
  tecidos?: string[] | null
  maquinas?: string[] | null
  forneceMaterial?: boolean | null
  capacidadeMes?: number | null
  aceitaEncaixe?: boolean | null
  fazDesenvolvimento?: boolean | null
  naoFaz?: string | null
  observacao?: string | null
  /** Prazo mínimo vive em leads_fornecedores porque o match lê de lá. */
  prazoMinimoDias?: number | null
}

/**
 * Grava o que a confecção disse. Só toca no que veio — campo ausente fica como
 * estava, campo com valor sobrescreve.
 *
 * O que veio de conversa NUNCA apaga o que já existe por omissão: se o Luigi
 * chamar sem `tecidos`, os tecidos de antes continuam lá. Perder dado por
 * silêncio seria o pior jeito de errar aqui.
 */
export async function salvarPerfil(fornecedorId: string, c: CamposPerfil): Promise<PerfilProducao> {
  const campos: Record<string, unknown> = { fornecedor_id: fornecedorId, atualizado_em: new Date().toISOString() }
  if (c.servicos?.length) campos.servicos = c.servicos
  if (c.tecidos?.length) campos.tecidos = c.tecidos
  if (c.maquinas?.length) campos.maquinas = c.maquinas
  if (c.forneceMaterial != null) campos.fornece_material = c.forneceMaterial
  if (c.capacidadeMes != null) campos.capacidade_mes = c.capacidadeMes
  if (c.aceitaEncaixe != null) campos.aceita_encaixe = c.aceitaEncaixe
  if (c.fazDesenvolvimento != null) campos.faz_desenvolvimento = c.fazDesenvolvimento
  if (c.naoFaz?.trim()) campos.nao_faz = c.naoFaz.trim()
  if (c.observacao?.trim()) campos.observacao = c.observacao.trim()

  // Respondeu alguma coisa = a conversa aconteceu. Marca a data na primeira
  // resposta e não mexe depois: é a data em que ela falou com a gente.
  const jaTinha = await lerPerfil(fornecedorId)
  if (!jaTinha?.respondido_em) campos.respondido_em = new Date().toISOString()

  const { data, error } = await supabaseAdmin
    .from('perfil_producao')
    .upsert(campos, { onConflict: 'fornecedor_id' })
    .select(COLUNAS)
    .single<PerfilProducao>()
  if (error) throw new Error(`salvar perfil: ${error.message}`)

  // prazo_minimo_dias mora no cadastro porque é lá que o match lê. Gravar nos
  // dois lugares criaria duas verdades sobre a mesma pergunta.
  if (c.prazoMinimoDias != null) {
    await supabaseAdmin
      .from('leads_fornecedores')
      .update({ prazo_minimo_dias: c.prazoMinimoDias })
      .eq('id', fornecedorId)
  }
  return data
}

/** Quem ainda não tem perfil — a fila da campanha de atualização. */
export async function fornecedoresSemPerfil(limite = 50): Promise<Array<{ id: string; nome: string | null; whatsapp: string | null; cidade: string | null; uf: string | null }>> {
  const { data: comPerfil } = await supabaseAdmin.from('perfil_producao').select('fornecedor_id').not('respondido_em', 'is', null)
  const jaTem = new Set(((comPerfil ?? []) as Array<{ fornecedor_id: string }>).map((p) => p.fornecedor_id))

  const { data } = await supabaseAdmin
    .from('leads_fornecedores')
    .select('id, nome, whatsapp, cidade, estado')
    .eq('aprovacao_status', 'aprovado')
    .eq('status', 'ativo')
    .limit(200)

  return ((data ?? []) as Array<{ id: string; nome: string | null; whatsapp: string | null; cidade: string | null; estado: string | null }>)
    .filter((f) => !jaTem.has(f.id) && f.whatsapp)
    .slice(0, limite)
    .map((f) => ({ id: f.id, nome: f.nome, whatsapp: f.whatsapp, cidade: f.cidade, uf: f.estado }))
}
