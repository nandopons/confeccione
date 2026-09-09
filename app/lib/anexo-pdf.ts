// app/lib/anexo-pdf.ts
// ============================================================================
// PDF QUE O CLIENTE MANDA, LIDO PELO AGENTE (09/09/2026)
//
// No B2B de confecção o PDF é o formato do assunto: ficha técnica, tabela de
// grade e tamanhos, arte da estampa, orçamento de concorrente, catálogo. Até
// aqui o agente via só "[documento]" e pedia pra pessoa digitar o conteúdo —
// que é justamente o trabalho que ela evitou mandando o arquivo.
//
// O bloco `document` da API do Claude aceita o PDF em base64 e lê texto E
// layout: tabela de grade continua sendo tabela, e não vira uma linha de
// números embaralhados como sairia de um extrator de texto comum.
//
// Compartilhado entre o Luigi e o agente de gestão de propósito — dois
// carregadores de anexo divergindo é como um deles passa a enxergar e o outro
// não, sem ninguém perceber.
// ============================================================================

import { supabaseAdmin } from './supabase-server'

/** Um PDF em base64, no formato que a API do Claude espera. */
export type BlocoPdf = {
  type: 'document'
  source: { type: 'base64'; media_type: 'application/pdf'; data: string }
}

/**
 * Teto de 4 MB, o mesmo das imagens.
 *
 * O limite da API é bem maior, mas o que manda aqui é o orçamento de tempo: o
 * agente responde dentro do maxDuration da rota, e um PDF grande em base64
 * infla o request e o tempo de processamento de toda rodada seguinte. Ficha
 * técnica e tabela de grade têm poucas centenas de KB; o que passa de 4 MB é
 * catálogo digitalizado, que não é o caso de uso.
 */
const TAMANHO_MAX = 4 * 1024 * 1024

export function ehPdf(mime: string | null | undefined): boolean {
  return (mime ?? '').split(';')[0]!.trim().toLowerCase() === 'application/pdf'
}

/**
 * Baixa o PDF do Storage e devolve o bloco pronto. `null` quando não deu — e aí
 * quem chama segue com "[documento]", como antes.
 */
export async function blocoDoPdf(path: string, mime: string | null): Promise<BlocoPdf | null> {
  if (!ehPdf(mime)) return null
  try {
    const { data, error } = await supabaseAdmin.storage.from('wa-midia').download(path)
    if (error || !data) return null
    const buffer = Buffer.from(await data.arrayBuffer())
    if (buffer.byteLength === 0 || buffer.byteLength > TAMANHO_MAX) return null
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } }
  } catch {
    return null
  }
}
