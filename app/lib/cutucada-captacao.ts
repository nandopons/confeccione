// app/lib/cutucada-captacao.ts
// ============================================================================
// A CONFECÇÃO QUE RESPONDEU E SUMIU LEVA UMA CUTUCADA, UMA SÓ — 17/09/2026
//
// O agente de captação só fala quando a confecção escreve. Quando ela para,
// acabou: `reabordarPendentes` reenvia sondagem que FALHOU, não fala com quem
// respondeu e silenciou. Em 14 dias, das 12 confecções que responderam ao
// fluxo novo, 6 pararam no meio — e o último balão era nosso em 5 delas:
// a MURY'S (só o bot dela respondeu), a Manxo (perguntou "como funciona",
// ouviu, sumiu), a Infocolor, a Pajú ("fico no aguardo"), a Tidy (600 becas,
// depois do bloco de comissão). Nenhuma ouviu mais nada da gente.
//
// Mesmo desenho da cutucada pós-resumo, deliberadamente pequeno:
//
//   • UMA vez por candidato (`cutucada_em`), nunca duas
//   • só se ELA escreveu depois da sondagem (engajou) e o último balão é NOSSO
//     há pelo menos duas horas — se ela falou por último, o agente está
//     devendo resposta, não cutucada
//   • só dentro da janela de 24h, em TEXTO LIVRE: é a mesma conversa
//     continuando, não outro template
//   • só se ninguém da equipe assumiu (escalada ou humano na conversa)
//   • em horário de gente ler mensagem de trabalho
//
// E a pergunta é a que faltou. Até 24/09 isso era decidido por
// `captacao_fornecedores.resposta`: nula → "vocês fazem?", interessado →
// "ficou dúvida?". Só que resposta nula NÃO quer dizer "nunca disse se faz":
// quer dizer que o agente não chamou registrar_resposta — e a Costureira
// Mesquita (24/09) tinha dito "mínimo 100 peças" pra um pedido de 1 bermuda,
// ouvido que não encaixava e recebido "o que vocês fazem?"; duas horas depois
// a cutucada perguntou "vocês fazem esse tipo de peça?", e o "Não" que voltou
// não responde a nada que dê pra registrar. A pergunta que faltou é a ÚLTIMA
// QUE A GENTE FEZ, e ela está no nosso último balão — é de lá que sai agora.
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import { enviarTexto, normalizarWaId } from './whatsapp-cloud'
import { acharConversaPorNumero, janela24hAberta, registrarSaidaInbox } from './whatsapp-notify'
import { humanoConduzindoPorTelefone } from './luigi'

/** Hora local de Recife. */
function horaEmRecife(agora = new Date()): number {
  return Number(new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Recife', hour: '2-digit', hour12: false }).format(agora))
}

/** Silêncio mínimo depois do nosso último balão. */
const HORAS_ATE_CUTUCAR = 2
/** Depois disto a conversa esfriou; sondagem de dois dias atrás é caso de nova onda, não de cutucada. */
const HORAS_LIMITE = 48
const HORA_MIN = 8
const HORA_MAX = 19
/** O cron roda a cada 15 min; isto não é disparo em massa. */
const MAX_POR_RODADA = 8

export type ResultadoCutucadaCaptacao = {
  enviadas: number
  puladas: number
  observacao?: string
}

type Candidata = {
  id: string
  nome: string | null
  whatsapp: string | null
  resposta: string | null
  ultimo_contato_em: string
}

type UltimasMensagens = {
  ultimaDela: string | null
  ultimaNossa: string | null
  /** Corpo do nosso último balão: é dele que sai a pergunta da cutucada. */
  ultimaNossaCorpo: string | null
  escaladaEm: string | null
}

const SEM_PERGUNTA_ABERTA = 'Ficou alguma dúvida? Posso responder aqui mesmo.'

/**
 * A pergunta que ficou sem resposta no nosso último balão: a última linha com
 * "?", da primeira frase interrogativa até o fim — "O que vocês fazem
 * exatamente? Facção, modelagem, só venda de pronto?" volta inteira, "Tudo
 * bem! Você pode me passar quem fala de produção?" volta sem o "Tudo bem!".
 * Se a linha termina em afirmação ("O que vocês fazem? Pode ser 3 exemplos."),
 * volta só a última interrogativa. Frase se separa em pontuação SEGUIDA de
 * espaço, pra "1.000 peças?" e "confeccione.com.br" não quebrarem no meio.
 * Cumprimento ("tudo bem?"), curta demais ou longa demais não é pergunta pra
 * repetir.
 */
export function ultimaPergunta(corpo: string | null): string | null {
  if (!corpo) return null
  const linha = corpo
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes('?'))
    .pop()
  if (!linha) return null
  const frases = linha.split(/(?<=[.!?])\s+/)
  const primeira = frases.findIndex((f) => f.endsWith('?'))
  if (primeira < 0) return null
  const doInicio = frases.slice(primeira).join(' ')
  const ultimaInterrogativa = [...frases].reverse().find((f) => f.endsWith('?')) ?? ''
  const p = (doInicio.endsWith('?') ? doInicio : ultimaInterrogativa).trim()
  if (p.length < 12 || p.length > 160) return null
  if (/tudo bem\?$/i.test(p)) return null
  return p
}

/**
 * Um texto só, e é a pergunta que a gente já tinha feito: quem leu e não
 * respondeu não precisa de pergunta nova, precisa da mesma de novo. Sem
 * pergunta em aberto (a última mensagem foi resposta a uma dúvida dela), abre
 * espaço pra dúvida.
 */
export function textoDaCutucada(ultimoBalaoNosso: string | null): string {
  const pergunta = ultimaPergunta(ultimoBalaoNosso)
  return pergunta ? `Conseguiu ver? ${pergunta}` : SEM_PERGUNTA_ABERTA
}

/**
 * Decide, só com datas, se a cutucada cabe. Separado pra ser testável sem
 * banco: é aqui que mora a regra, e é a regra que precisa estar certa.
 */
export function cabeCutucar(
  m: UltimasMensagens,
  sondadaEm: string,
  agora = Date.now()
): { cabe: boolean; motivo: string } {
  if (!m.ultimaDela) return { cabe: false, motivo: 'ela nunca escreveu' }
  if (new Date(m.ultimaDela).getTime() <= new Date(sondadaEm).getTime()) return { cabe: false, motivo: 'escreveu antes da sondagem' }
  if (!m.ultimaNossa) return { cabe: false, motivo: 'a gente nunca respondeu' }
  const dela = new Date(m.ultimaDela).getTime()
  const nossa = new Date(m.ultimaNossa).getTime()
  if (dela >= nossa) return { cabe: false, motivo: 'ela falou por último — o agente deve resposta, não cutucada' }
  if (agora - nossa < HORAS_ATE_CUTUCAR * 3_600_000) return { cabe: false, motivo: 'nosso último balão é recente' }
  if (agora - dela > 22 * 3_600_000) return { cabe: false, motivo: 'janela de 24h fechando' }
  if (m.escaladaEm && new Date(m.escaladaEm).getTime() >= new Date(sondadaEm).getTime()) return { cabe: false, motivo: 'escalada pra gente' }
  return { cabe: true, motivo: 'ok' }
}

async function ultimasMensagens(waId: string): Promise<{ conversaId: string; m: UltimasMensagens } | null> {
  // Conversa por número, tolerando o nono dígito — pela função única de
  // whatsapp-notify (a cópia local filtrava uma coluna que não existe).
  const conversa = await acharConversaPorNumero(waId)
  if (!conversa) return null
  const { data, error } = await supabaseAdmin
    .from('wa_mensagens')
    .select('direcao, criado_em, corpo, tipo')
    .eq('conversa_id', conversa.id)
    .order('criado_em', { ascending: false })
    .limit(30)
  if (error) throw new Error(`mensagens da conversa ${conversa.id}: ${error.message}`)
  const linhas = (data ?? []) as Array<{ direcao: string; criado_em: string; corpo: string | null; tipo: string | null }>
  const nossa = linhas.find((l) => l.direcao === 'saida')
  return {
    conversaId: conversa.id,
    m: {
      ultimaDela: linhas.find((l) => l.direcao === 'entrada')?.criado_em ?? null,
      ultimaNossa: nossa?.criado_em ?? null,
      // A sondagem (template) não é pergunta pra repetir: "tudo bem?" não é a dúvida.
      ultimaNossaCorpo: nossa && nossa.tipo !== 'template' ? nossa.corpo : null,
      escaladaEm: conversa.luigi_escalado_em,
    },
  }
}

async function marcarCutucada(id: string): Promise<void> {
  await supabaseAdmin.from('captacao_fornecedores').update({ cutucada_em: new Date().toISOString() }).eq('id', id)
}

/** Roda a cutucada. Failure-soft: um envio que falha não derruba os outros. */
export async function rodarCutucadaCaptacao(): Promise<ResultadoCutucadaCaptacao> {
  const hora = horaEmRecife()
  if (hora < HORA_MIN || hora >= HORA_MAX) {
    return { enviadas: 0, puladas: 0, observacao: `fora do horário (${HORA_MIN}h–${HORA_MAX}h)` }
  }

  const desde = new Date(Date.now() - HORAS_LIMITE * 3_600_000).toISOString()
  const { data, error } = await supabaseAdmin
    .from('captacao_fornecedores')
    .select('id, nome, whatsapp, resposta, ultimo_contato_em')
    .eq('origem', 'pedido')
    .eq('status', 'ativo')
    .is('cutucada_em', null)
    .is('convertido_em', null)
    .or('resposta.is.null,resposta.eq.interessado')
    .not('whatsapp', 'is', null)
    .gte('ultimo_contato_em', desde)
    .limit(60)
  // Consulta que falha não é "ninguém pra cutucar": ver AGENTS.md.
  if (error) throw new Error(`cutucada de captação: ${error.message}`)

  const candidatas = (data ?? []) as Candidata[]
  let enviadas = 0
  let puladas = 0
  for (const c of candidatas) {
    if (enviadas >= MAX_POR_RODADA) break
    try {
      const waId = normalizarWaId(c.whatsapp as string)
      const u = await ultimasMensagens(waId)
      if (!u) {
        puladas++
        continue
      }
      const decisao = cabeCutucar(u.m, c.ultimo_contato_em)
      if (!decisao.cabe) {
        puladas++
        continue
      }
      if (!(await janela24hAberta(waId))) {
        puladas++
        continue
      }
      const conduzindo = await humanoConduzindoPorTelefone(waId)
      if (conduzindo.conduzindo) {
        puladas++
        continue
      }
      const texto = textoDaCutucada(u.m.ultimaNossaCorpo)
      const r = await enviarTexto(waId, texto)
      if (!r.ok) {
        console.error('[cutucada-captacao] envio falhou', { candidato: c.id, erro: r.erro })
        puladas++
        continue
      }
      await marcarCutucada(c.id)
      await registrarSaidaInbox(waId, c.nome, r.wamid, texto, null, 'luigi')
      enviadas++
    } catch (err) {
      console.error('[cutucada-captacao] erro no candidato', { candidato: c.id, err })
      puladas++
    }
  }
  return { enviadas, puladas }
}
