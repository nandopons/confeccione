// app/lib/sessoes.ts
// ============================================================================
// Gerenciamento de sessões de fornecedor.
// Token aleatório de 32 bytes (256 bits), salvo como hash SHA-256 no banco.
// Cookie httpOnly, secure, SameSite=Lax, válido por 30 dias.
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import { createHash, randomBytes } from 'node:crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const SESSAO_DURACAO_DIAS = 30
export const COOKIE_NAME = 'confeccione_session'

/**
 * Gera um token de sessão criptograficamente aleatório.
 * 32 bytes = 256 bits de entropia, em base64url (~43 caracteres).
 */
export function gerarTokenSessao(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Hash SHA-256 do token (pra salvar no banco — nunca em claro).
 */
export function hashTokenSessao(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Cria uma nova sessão pra um fornecedor.
 * Retorna o token em claro pra ser setado no cookie.
 */
export async function criarSessao(params: {
  fornecedorId: string
  userAgent?: string
}): Promise<{ token: string; expiraEm: Date }> {
  const token = gerarTokenSessao()
  const tokenHash = hashTokenSessao(token)
  const expiraEm = new Date(Date.now() + SESSAO_DURACAO_DIAS * 24 * 60 * 60 * 1000)

  const { error } = await supabase.from('sessoes_fornecedores').insert({
    fornecedor_id: params.fornecedorId,
    token_hash: tokenHash,
    expira_em: expiraEm.toISOString(),
    user_agent: params.userAgent ?? null,
  })

  if (error) {
    throw new Error(`Erro ao criar sessão: ${error.message}`)
  }

  return { token, expiraEm }
}

/**
 * Valida um token de sessão recebido via cookie.
 * Retorna o fornecedor associado, ou null se inválido/expirado.
 *
 * Atualiza ultimo_acesso_em pra audit trail (best-effort, não bloqueia).
 */
export async function validarSessao(token: string): Promise<{
  fornecedorId: string
  fornecedor: {
    id: string
    nome: string
    whatsapp: string
    email: string | null
    status: string
  }
} | null> {
  if (!token || typeof token !== 'string' || token.length < 20) {
    return null
  }

  const tokenHash = hashTokenSessao(token)
  const agoraISO = new Date().toISOString()

  const { data: sessao } = await supabase
    .from('sessoes_fornecedores')
    .select('id, fornecedor_id, expira_em')
    .eq('token_hash', tokenHash)
    .gt('expira_em', agoraISO)
    .maybeSingle()

  if (!sessao) return null

  // Busca dados do fornecedor
  const { data: fornecedor } = await supabase
    .from('leads_fornecedores')
    .select('id, nome, whatsapp, email, status')
    .eq('id', sessao.fornecedor_id)
    .single()

  if (!fornecedor) return null

  // Atualiza ultimo_acesso_em (best-effort, não bloqueia se falhar)
  supabase
    .from('sessoes_fornecedores')
    .update({ ultimo_acesso_em: agoraISO })
    .eq('id', sessao.id)
    .then(
      () => undefined,
      (err) => console.error('[sessoes] update ultimo_acesso falhou:', err)
    )

  return {
    fornecedorId: fornecedor.id,
    fornecedor,
  }
}

/**
 * Invalida uma sessão específica (logout).
 * Apaga do banco.
 */
export async function invalidarSessao(token: string): Promise<void> {
  if (!token) return
  const tokenHash = hashTokenSessao(token)
  await supabase.from('sessoes_fornecedores').delete().eq('token_hash', tokenHash)
}

/**
 * Invalida TODAS as sessões de um fornecedor.
 * Útil pra "deslogar de todos os dispositivos" (futura feature).
 */
export async function invalidarTodasSessoesFornecedor(
  fornecedorId: string
): Promise<void> {
  await supabase
    .from('sessoes_fornecedores')
    .delete()
    .eq('fornecedor_id', fornecedorId)
}

/**
 * Retorna o `domain` correto pro cookie de sessão.
 *
 * - Em produção (Vercel com env COOKIE_DOMAIN=.confeccione.com.br):
 *   o cookie vale pra apex e qualquer subdomínio.
 * - Em dev local, deploys preview *.vercel.app, ou se a env var não estiver
 *   setada: undefined → cookie é host-only (comportamento padrão do browser).
 */
export function getCookieDomain(): string | undefined {
  const dom = process.env.COOKIE_DOMAIN
  return dom && dom.length > 0 ? dom : undefined
}
