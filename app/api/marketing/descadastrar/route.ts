// GET /api/marketing/descadastrar?lead=<id> — link de descadastro do rodapé
// dos e-mails de campanha. Rota PÚBLICA (o link vai no e-mail), mas só
// consegue marcar opt-out de um id que já existe — nada é exposto.
import { NextRequest, NextResponse } from 'next/server'
import { definirOptOut, obterLead } from '@/app/lib/leads-marketing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function pagina(titulo: string, texto: string): NextResponse {
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo}</title></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f5f5f5;">
<div style="max-width:520px;margin:64px auto;background:#fff;border-radius:12px;padding:32px;text-align:center;">
<h1 style="font-size:20px;margin:0 0 12px;color:#111;">${titulo}</h1>
<p style="color:#555;line-height:1.6;margin:0 0 24px;">${texto}</p>
<a href="https://www.confeccione.com.br" style="color:#1D9E75;text-decoration:none;font-weight:600;">Voltar pra Confeccione</a>
</div></body></html>`
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('lead') ?? ''
  if (!UUID_RE.test(id)) return pagina('Link inválido', 'Esse link de descadastro não é válido.')
  const lead = await obterLead(id)
  if (!lead) return pagina('Link inválido', 'Não encontramos esse cadastro.')
  if (!lead.optOut) await definirOptOut(id, true)
  return pagina(
    'Pronto, você saiu da lista',
    'Não vamos mais te mandar e-mails de novidades. Se mudar de ideia, é só falar com a gente.'
  )
}

// One-click unsubscribe (RFC 8058) — provedores chamam por POST.
export async function POST(req: NextRequest) {
  return GET(req)
}
