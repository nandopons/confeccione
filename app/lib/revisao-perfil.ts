// app/lib/revisao-perfil.ts
// ============================================================================
// REVISÃO SEMESTRAL DO PORTFÓLIO — 29/09/2026 (decisão do Fernando)
//
// A lista de peças de uma confecção muda: entra linha nova, sai máquina. O
// cadastro do site é de quando ela entrou; a entrevista do Luigi é de uma vez.
// O Fernando: "a cada 6 meses a gente conversa com eles: manda os tipos de
// produto que a gente tem deles e pergunta se entrou algo novo ou se querem
// tirar algum".
//
// Só isto. Não é entrevista de novo, não pergunta mínimo, prazo, "o que
// recusam" — é a lista atual e uma pergunta. A resposta cai no Luigi
// fornecedor, que sabe que perguntou (perfil_revisado_em recente) e grava com
// salvar_perfil_producao (pecas pra somar, pecas_remover pra tirar).
//
// Regras:
//   • aprovada, com WhatsApp, com peças no cadastro
//   • (perfil_revisado_em ?? criado_em) há mais de 180 dias
//   • horário comercial (9h–11h, seg–sex) — é abordagem, não urgência
//   • poucas por rodada: é conversa, não campanha
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import { avisoOficial } from './whatsapp-notify'
import { estaEmHorarioComercial } from './horario'
import { pecaLabel } from './pecas'

const DIAS = 180
const MAX_POR_RODADA = 5

export type ResultadoRevisaoPerfil = { enviadas: number; puladas: number; observacao?: string }

export function textoDaRevisao(nome: string | null, pecas: string[]): { texto: string; resumo: string } {
  const primeiro = (nome ?? '').trim().split(/\s+/)[0]
  const lista = pecas.map((p) => pecaLabel(p) || p).filter(Boolean).join(', ')
  return {
    texto:
      `${primeiro ? `Oi, ${primeiro}! ` : 'Oi! '}Aqui na Confeccione a gente tem você pra: ${lista}\n\n` +
      'Entrou peça nova na linha de vocês, ou tem alguma aí pra tirar? Me responde por aqui que eu atualizo',
    resumo: `a gente tem você pra ${lista} — entrou peça nova ou tem alguma pra tirar? Me responde por aqui que eu atualizo`,
  }
}

export async function rodarRevisaoPerfil(): Promise<ResultadoRevisaoPerfil> {
  if (!estaEmHorarioComercial()) return { enviadas: 0, puladas: 0, observacao: 'fora do horário comercial' }
  const corte = new Date(Date.now() - DIAS * 24 * 3600_000).toISOString()
  const { data, error } = await supabaseAdmin
    .from('leads_fornecedores')
    .select('id, nome, whatsapp, pecas, criado_em, perfil_revisado_em')
    .eq('aprovacao_status', 'aprovado')
    .not('whatsapp', 'is', null)
    .or(`perfil_revisado_em.lt.${corte},and(perfil_revisado_em.is.null,criado_em.lt.${corte})`)
    .order('perfil_revisado_em', { ascending: true, nullsFirst: true })
    .limit(20)
  if (error) throw new Error(`revisão de perfil: ${error.message}`)

  let enviadas = 0
  let puladas = 0
  for (const f of (data ?? []) as Array<{ id: string; nome: string | null; whatsapp: string | null; pecas: string[] | null }>) {
    if (enviadas >= MAX_POR_RODADA) break
    if (!f.whatsapp || !f.pecas || f.pecas.length === 0) {
      puladas++
      continue
    }
    try {
      const t = textoDaRevisao(f.nome, f.pecas)
      const ok = await avisoOficial({ telefone: f.whatsapp, nome: f.nome, texto: t.texto, resumo: t.resumo, caminhoBotao: 'fornecedor' })
      if (!ok) {
        puladas++
        continue
      }
      await supabaseAdmin.from('leads_fornecedores').update({ perfil_revisado_em: new Date().toISOString() }).eq('id', f.id)
      enviadas++
    } catch (err) {
      console.error('[revisao-perfil] erro', { fornecedor: f.id, err })
      puladas++
    }
  }
  return { enviadas, puladas }
}
