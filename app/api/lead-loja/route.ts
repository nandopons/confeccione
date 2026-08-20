// app/api/lead-loja/route.ts
// ============================================================================
// Recebe os leads do pop-up que antecede o WhatsApp da loja e grava em
// leads_loja (service role; RLS deny pra anon).
//
// POR QUE ESTA ROTA VIVE NO SISTEMA E NAO NA LOJA
// A loja e Nuvemshop: tema, sem backend. Entao o formulario dela posta aqui,
// em confeccione.com.br, que ja tem Supabase e chave de service role. Como sao
// origens diferentes, esta rota precisa de CORS explicito — dai o OPTIONS e o
// Access-Control-Allow-Origin restrito.
//
// ORIGENS ACEITAS
// Lista fechada. Qualquer outra origem recebe 204 sem gravar: nao vale a pena
// abrir isso para o mundo, porque a tabela guarda dado pessoal.
//
// FAILURE-SOFT, MAS NAO CEGO
// Nunca devolve erro para o visitante — o pop-up nao pode travar por causa do
// banco. Mas o lead nao se perde nesse caso: os mesmos dados vao dentro da
// mensagem do WhatsApp, que e a via principal. O banco e o registro, nao o
// unico caminho.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/app/lib/supabase-server'

export const dynamic = 'force-dynamic'

const ORIGENS = new Set([
  'https://loja.confeccione.com.br',
  'https://confeccione.com.br',
  'https://www.confeccione.com.br',
])

function cabecalhosCors(origem: string | null): Record<string, string> {
  const permitida = origem && ORIGENS.has(origem) ? origem : ''
  if (!permitida) return {}
  return {
    'Access-Control-Allow-Origin': permitida,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function corta(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: cabecalhosCors(req.headers.get('origin')),
  })
}

export async function POST(req: NextRequest) {
  const origem = req.headers.get('origin')
  const cors = cabecalhosCors(origem)

  // Origem desconhecida: responde 204 e nao grava. Silencioso de proposito —
  // nao ha motivo para dizer a um script de fora o que foi rejeitado.
  if (!Object.keys(cors).length) {
    return new NextResponse(null, { status: 204 })
  }

  try {
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null

    const nome = corta(b?.nome, 120)
    const email = corta(b?.email, 180)
    const telefone = corta(b?.telefone, 40)
    const digitos = (telefone || '').replace(/\D/g, '')

    // Mesmas regras do formulario, revalidadas aqui: validacao no browser
    // impede engano, nao impede quem posta direto na rota.
    const valido =
      !!nome && nome.length >= 2 &&
      !!email && RE_EMAIL.test(email) &&
      digitos.length >= 10 && digitos.length <= 13

    if (!valido) {
      return new NextResponse(null, { status: 204, headers: cors })
    }

    await supabaseAdmin.from('leads_loja').insert({
      nome,
      email,
      telefone,
      telefone_digitos: digitos,
      origem: corta(b?.origem, 60) || 'botao_whatsapp_loja',
      pagina: corta(b?.pagina, 300),
      destino_whatsapp: corta(b?.destino, 20),
      gclid: corta(b?.gclid, 200),
      utm_source: corta(b?.utm_source, 120),
      utm_medium: corta(b?.utm_medium, 120),
      utm_campaign: corta(b?.utm_campaign, 160),
      referrer: corta(b?.referrer, 300),
      user_agent: corta(req.headers.get('user-agent'), 300),
    })
  } catch {
    // nunca propaga: o visitante segue para o WhatsApp de qualquer jeito
  }

  return new NextResponse(null, { status: 204, headers: cors })
}
