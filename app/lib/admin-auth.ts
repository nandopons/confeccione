// app/lib/admin-auth.ts
// ============================================================================
// Validação de sessão admin — defesa em profundidade.
//
// MODELO: o cookie 'confeccione_admin_session' contém literalmente o valor
// de ADMIN_SESSION_TOKEN (definido em env). Quem tem o cookie certo é admin.
// Rotação: regenerar a env e exigir re-login.
//
// CAMADAS:
//   1. middleware.ts (Edge)     → barreira rápida (cookie existe + length)
//   2. esta lib (Node runtime)  → validação real (cookie === env token)
//
// Use ehTokenAdminValido(cookieValue) em route handlers,
// e eAdminLogado() em Server Components.
//
// NÃO importar no middleware (Edge): ADMIN_SESSION_TOKEN não deve ir pro
// bundle do Edge — facilita rotação e reduz superfície.
// ============================================================================

import { cookies } from 'next/headers'
import { timingSafeEqual } from 'node:crypto'

export const COOKIE_ADMIN = 'confeccione_admin_session'

/** Comparação string em tempo constante. Defesa contra timing attack.
 *
 *  timingSafeEqual exige buffers de mesmo tamanho. Se os lengths diferem,
 *  fazemos um compare fake (A com A) só pra preservar o tempo e retornamos
 *  false. NÃO é perfeito — o tamanho da senha ainda pode vazar via timing
 *  de paths distintos. Mitigação completa exigiria hashear ambos pra
 *  length fixa antes; por ora, isto cobre o caso clássico de === ingênuo. */
export function compararSeguro(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

/** Compara o valor de um cookie com ADMIN_SESSION_TOKEN em tempo constante.
 *  Retorna true sse coincide exatamente. */
export function ehTokenAdminValido(valor: string | undefined): boolean {
  const esperado = process.env.ADMIN_SESSION_TOKEN
  if (!esperado) {
    console.error('[admin-auth] ADMIN_SESSION_TOKEN ausente — bloqueando acesso')
    return false
  }
  if (!valor) return false
  return compararSeguro(valor, esperado)
}

/** Lê o cookie admin do request atual (Server Component) e valida.
 *  Use no topo de pages /admin/* pra checagem real (defesa em profundidade
 *  além da barreira rápida do middleware). */
export async function eAdminLogado(): Promise<boolean> {
  const store = await cookies()
  return ehTokenAdminValido(store.get(COOKIE_ADMIN)?.value)
}
