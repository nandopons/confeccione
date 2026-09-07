// POST /api/admin/marketing/templates/previa
//   { blocos, assunto? }            → devolve o HTML renderizado (prévia fiel:
//                                     é o MESMO renderizador do envio real)
//   { blocos, assunto, para: '...' } → manda um e-mail de teste pra esse endereço
//
// A prévia usa um lead fictício só pra resolver #nome, #empresa e #cidade —
// nada é gravado e nenhum lead real é tocado.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { normalizarBlocos, renderBlocosHtml } from '@/app/lib/email-blocos'
import { aplicarPlaceholders } from '@/app/lib/envio-marketing'
import { enviarEmailMarketing } from '@/app/lib/email'
import type { Lead } from '@/app/lib/leads-marketing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Body = z.object({
  blocos: z.array(z.record(z.string(), z.unknown())).max(40),
  assunto: z.string().max(150).optional(),
  para: z.string().email().optional(),
})

/** Lead de mentira, só pra prévia — nunca vai pro banco. */
const LEAD_EXEMPLO: Lead = {
  id: '00000000-0000-0000-0000-000000000000',
  nome: 'Maria Souza',
  empresa: 'Ateliê da Maria',
  telefone: null,
  email: 'exemplo@confeccione.com.br',
  cidade: 'Recife',
  uf: 'PE',
  cep: null,
  logradouro: null,
  numero: null,
  complemento: null,
  bairro: null,
  origem: 'manual',
  tags: [],
  observacao: null,
  status: 'lead',
  optOut: false,
  pedidoId: null,
  ultimoContatoEm: null,
  toques: 0,
  criadoEm: new Date().toISOString(),
}

export async function POST(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ erro: 'Dados inválidos' }, { status: 400 })

  const blocos = normalizarBlocos(parsed.data.blocos)
  const html = aplicarPlaceholders(renderBlocosHtml(blocos), LEAD_EXEMPLO)
  const assunto = aplicarPlaceholders(parsed.data.assunto?.trim() || 'Confeccione', LEAD_EXEMPLO)

  if (!parsed.data.para) {
    return NextResponse.json({ ok: true, html, assunto })
  }

  const r = await enviarEmailMarketing({
    para: parsed.data.para,
    assunto: `[teste] ${assunto}`,
    corpo: 'Prévia do template de marketing.',
    html,
    leadId: LEAD_EXEMPLO.id,
  })
  return r.ok
    ? NextResponse.json({ ok: true, enviado: true })
    : NextResponse.json({ erro: r.erro ?? 'Falha no envio de teste' }, { status: 400 })
}
