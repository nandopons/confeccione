// app/lib/resumo-hash.ts
// Assinatura do conteúdo do resumo em PDF. Módulo puro (sem banco) porque é
// lido tanto por quem DECIDE reenviar (pedido-fechamento) quanto por quem
// ENVIA (whatsapp-notify) — e um importa o outro.

import { createHash } from 'node:crypto'

/**
 * O QUE O PDF MOSTRA, REDUZIDO A UMA ASSINATURA — 24/09/2026.
 *
 * "O pedido mudou desde o último resumo?" era respondido por `atualizado_em`,
 * e `atualizado_em` mente: sobe quando o Luigi re-anexa uma foto que já estava
 * lá, quando ele reescreve a mesma descrição com outras vírgulas, quando
 * qualquer ferramenta toca a linha. O cliente não vê nada disso. O que ele vê
 * é o PDF — e o PDF é função destes campos, os mesmos que
 * `enviarResumoPdfPedido` lê pra montá-lo. Mesma assinatura, mesmo PDF; e
 * PDF igual não sai duas vezes, mande quem mandar.
 *
 * As chaves são ordenadas em todos os níveis: jsonb devolve objeto com a
 * ordem que o Postgres quiser, e duas gravações do mesmo conteúdo precisam
 * dar a mesma assinatura.
 */
export const CAMPOS_DO_RESUMO = 'nome, linhas, prazo_dias, cep, numero, complemento, logradouro, bairro, cidade, uf, mockups, imagens, observacoes'

function canonico(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonico)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [k, canonico(o[k])])
    )
  }
  return v ?? null
}

export function hashDoResumo(dados: Record<string, unknown>): string {
  const campos = CAMPOS_DO_RESUMO.split(',').map((c) => c.trim())
  const so = Object.fromEntries(campos.map((c) => [c, canonico(dados[c])]))
  return createHash('sha256').update(JSON.stringify(so)).digest('hex')
}
