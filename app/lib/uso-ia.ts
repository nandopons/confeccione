// app/lib/uso-ia.ts
// ============================================================================
// QUANTO A GENTE GASTA COM A API DA ANTHROPIC.
//
// Toda chamada ao Claude devolve `usage` com a contagem de tokens. A gente
// grava isso em uso_ia junto com o custo estimado, e o dashboard soma.
//
// Por que não perguntar o saldo pra Anthropic: não existe endpoint público de
// saldo de crédito. Existe a Usage & Cost API, mas ela exige uma admin key de
// organização (sk-ant-admin01-…) que lê o gasto da org inteira — chave desse
// alcance não entra em app web. O saldo real fica no Console; o dashboard
// linka pra lá e mostra o gasto medido aqui.
//
// Os preços abaixo são por MILHÃO de tokens, em dólar, conforme a tabela
// pública da Anthropic (set/2026). Se mudar de modelo, atualize aqui — o
// custo é estimativa nossa, não a fatura.
// ============================================================================

import { supabaseAdmin } from './supabase-server'

type Preco = { entrada: number; saida: number; cacheLeitura: number; cacheEscrita: number }

const PRECOS: Record<string, Preco> = {
  'claude-sonnet-4-6': { entrada: 3, saida: 15, cacheLeitura: 0.3, cacheEscrita: 3.75 },
  'claude-haiku-4-5': { entrada: 1, saida: 5, cacheLeitura: 0.1, cacheEscrita: 1.25 },
}

/** Modelo vem com sufixo de data às vezes ('claude-haiku-4-5-20251001'). */
function precoDoModelo(modelo: string): Preco {
  for (const [chave, preco] of Object.entries(PRECOS)) {
    if (modelo.startsWith(chave)) return preco
  }
  // Modelo desconhecido: assume o mais caro que usamos, pra não subestimar.
  return PRECOS['claude-sonnet-4-6']
}

/** Custo em milésimos de centavo de dólar (usd × 100.000), inteiro. */
export function custoMicro(
  modelo: string,
  t: { entrada: number; saida: number; cacheLeitura?: number; cacheEscrita?: number }
): number {
  const p = precoDoModelo(modelo)
  const usd =
    (t.entrada * p.entrada +
      t.saida * p.saida +
      (t.cacheLeitura ?? 0) * p.cacheLeitura +
      (t.cacheEscrita ?? 0) * p.cacheEscrita) /
    1_000_000
  return Math.round(usd * 100_000)
}

/** O formato de `usage` que a SDK devolve (campos de cache são opcionais). */
export type UsoResposta = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

/**
 * Registra uma chamada. NUNCA lança: contabilidade não pode derrubar o chat
 * do cliente. Chame sem await (fire-and-forget) nas rotas quentes.
 */
export async function registrarUsoIa(
  rota: string,
  modelo: string,
  usage: UsoResposta | null | undefined
): Promise<void> {
  try {
    if (!usage) return
    const entrada = usage.input_tokens ?? 0
    const saida = usage.output_tokens ?? 0
    const cacheLeitura = usage.cache_read_input_tokens ?? 0
    const cacheEscrita = usage.cache_creation_input_tokens ?? 0
    if (entrada + saida + cacheLeitura + cacheEscrita === 0) return

    await supabaseAdmin.from('uso_ia').insert({
      rota,
      modelo,
      tokens_entrada: entrada,
      tokens_saida: saida,
      tokens_cache_leitura: cacheLeitura,
      tokens_cache_escrita: cacheEscrita,
      custo_micro: custoMicro(modelo, { entrada, saida, cacheLeitura, cacheEscrita }),
    })
  } catch (e) {
    console.error('[uso-ia] falhou ao registrar (ignorado)', e)
  }
}

export type ResumoUsoIa = {
  mesUsd: number
  mesChamadas: number
  hojeUsd: number
  hojeChamadas: number
  /** Média diária dos últimos 30 dias — base da projeção. */
  projecaoMesUsd: number
  porRota: Array<{ rota: string; usd: number; chamadas: number }>
  desdeQuando: string | null
}

type LinhaUso = { rota: string; custo_micro: number; criado_em: string }

/** Números do card do dashboard. Mês = mês corrente (fuso de Recife). */
export async function resumoUsoIa(): Promise<ResumoUsoIa> {
  const agora = new Date()
  // Início do mês em Recife (UTC-3) expresso em UTC.
  const ano = Number(new Intl.DateTimeFormat('en', { timeZone: 'America/Recife', year: 'numeric' }).format(agora))
  const mes = Number(new Intl.DateTimeFormat('en', { timeZone: 'America/Recife', month: 'numeric' }).format(agora))
  const inicioMes = new Date(Date.UTC(ano, mes - 1, 1, 3, 0, 0)).toISOString()

  const { data } = await supabaseAdmin
    .from('uso_ia')
    .select('rota, custo_micro, criado_em')
    .gte('criado_em', inicioMes)
    .order('criado_em', { ascending: false })
    .limit(20000)

  const linhas = (data ?? []) as LinhaUso[]
  const hojeBR = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Recife' }).format(agora)

  let mesMicro = 0
  let hojeMicro = 0
  let hojeChamadas = 0
  const porRota = new Map<string, { micro: number; chamadas: number }>()

  for (const l of linhas) {
    mesMicro += l.custo_micro
    const r = porRota.get(l.rota) ?? { micro: 0, chamadas: 0 }
    r.micro += l.custo_micro
    r.chamadas += 1
    porRota.set(l.rota, r)

    if (new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Recife' }).format(new Date(l.criado_em)) === hojeBR) {
      hojeMicro += l.custo_micro
      hojeChamadas += 1
    }
  }

  const usd = (micro: number) => micro / 100_000
  const diaDoMes = Number(hojeBR.slice(-2))
  const diasNoMes = new Date(ano, mes, 0).getDate()

  return {
    mesUsd: usd(mesMicro),
    mesChamadas: linhas.length,
    hojeUsd: usd(hojeMicro),
    hojeChamadas,
    projecaoMesUsd: diaDoMes > 0 ? (usd(mesMicro) / diaDoMes) * diasNoMes : 0,
    porRota: [...porRota.entries()]
      .map(([rota, v]) => ({ rota, usd: usd(v.micro), chamadas: v.chamadas }))
      .sort((a, b) => b.usd - a.usd),
    desdeQuando: linhas.length > 0 ? linhas[linhas.length - 1].criado_em : null,
  }
}
