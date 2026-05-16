import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL) {
  throw new Error(
    '[supabase-server] NEXT_PUBLIC_SUPABASE_URL não definida. ' +
    'Verifique .env.local em dev ou variáveis da Vercel em produção.'
  )
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    '[supabase-server] SUPABASE_SERVICE_ROLE_KEY não definida. ' +
    'Esta chave bypassa RLS e nunca deve ser exposta ao browser. ' +
    'Use apenas em código server-side (route handlers, crons, server components).'
  )
}

/**
 * Client Supabase admin com service_role key.
 *
 * ⚠️  USO EXCLUSIVAMENTE SERVER-SIDE. Esta chave bypassa RLS e tem acesso
 *    total ao banco. Nunca importar em código que pode rodar no browser
 *    (Client Components, hooks, qualquer coisa com 'use client').
 *
 * Padrão singleton top-level: o client é criado uma vez no carregamento
 * do módulo e reusado em todas as invocações serverless da mesma instância.
 * Coerente com o padrão usado em 9 outros arquivos da base.
 */
export const supabaseAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
)
