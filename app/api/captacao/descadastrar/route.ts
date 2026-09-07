// GET /api/captacao/descadastrar?c=<id> — link de saída do rodapé da sondagem
// de produção (captação puxada pelo pedido). Rota PÚBLICA (o link vai no
// e-mail), mas só marca opt-out de um id que já existe — nada é exposto.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { registrarRespostaCandidato } from '@/app/lib/captacao-pedido'

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
<a href="https://confeccione.com.br" style="color:#1D9E75;text-decoration:none;font-weight:600;">Confeccione</a>
</div></body></html>`
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('c') ?? ''
  if (!UUID_RE.test(id)) return pagina('Link inválido', 'Esse link não é válido.')
  const { data } = await supabaseAdmin.from('captacao_fornecedores').select('id, resposta').eq('id', id).maybeSingle<{ id: string; resposta: string | null }>()
  if (!data) return pagina('Link inválido', 'Não encontramos esse contato.')
  if (data.resposta !== 'opt_out') await registrarRespostaCandidato(id, 'opt_out', 'saiu pelo link do e-mail')
  return pagina('Pronto, não mandamos mais', 'Vocês não vão receber mais pedidos da Confeccione. Se mudarem de ideia, é só falar com a gente.')
}

export async function POST(req: NextRequest) {
  return GET(req)
}
