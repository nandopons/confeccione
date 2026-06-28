/**
 * Helper de auth para os endpoints de LEITURA consumidos pelo app mobile.
 *
 * Reusa as tabelas de sessão que já existem (sessoes_clientes / sessoes_fornecedores):
 * o app manda `Authorization: Bearer <token>`; aqui a gente hasheia e bate com token_hash.
 *
 * Alinhado ao login OTP da web:
 * - hash do token: SHA-256 hex — mesmo esquema de `hashToken` (cliente-auth) e
 *   `hashTokenSessao` (sessoes). Importamos o canônico do cliente pra não duplicar.
 * - fornecedor: reusa `validarSessao` de '@/app/lib/sessoes' (já valida hash + expiração).
 * - client service-role: reusa `supabaseAdmin` de '@/app/lib/supabase-server'.
 *
 * Obs.: o cliente não tem helper que aceite token cru (getContaAtual lê o cookie),
 * então a sessão do cliente é resolvida aqui mesmo, usando o mesmo hashToken.
 */
import { supabaseAdmin } from '@/app/lib/supabase-server';
import { hashToken } from '@/app/lib/cliente-auth';
import { validarSessao } from '@/app/lib/sessoes';

// Re-export pra as rotas mobile continuarem importando tudo de '@/lib/mobileAuth'.
export { supabaseAdmin };

function bearer(req: Request): string | null {
  const h = req.headers.get('authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export async function getContaId(req: Request): Promise<string | null> {
  const token = bearer(req);
  if (!token) return null;
  const { data, error } = await supabaseAdmin
    .from('sessoes_clientes')
    .select('conta_id, expira_em')
    .eq('token_hash', hashToken(token))
    .gt('expira_em', new Date().toISOString())
    .maybeSingle();
  if (error || !data) return null;
  return data.conta_id ?? null;
}

export async function getFornecedorId(req: Request): Promise<string | null> {
  const token = bearer(req);
  if (!token) return null;
  const sessao = await validarSessao(token);
  return sessao?.fornecedorId ?? null;
}

/** Resposta 401 padrão. */
export function unauthorized() {
  return Response.json({ error: 'Não autenticado' }, { status: 401 });
}
