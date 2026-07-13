/**
 * POST /api/admin/fornecedores/[id]/aprovar
 * Aprova um fornecedor pendente: libera para receber pedidos, dispara
 * matching retroativo e avisa o fornecedor (WhatsApp + e-mail de boas-vindas).
 * Idempotente: já aprovado → ok sem reprocessar.
 */
import { NextRequest, NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { registrarAudit } from '@/app/lib/audit'
import { avisoOficial } from '@/app/lib/whatsapp-notify'
import { emailBoasVindasFornecedor } from '@/app/lib/email'
import { matchingRetroativo } from '@/app/lib/orfaos'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const cookieValue = req.cookies.get(COOKIE_ADMIN)?.value
  if (!ehTokenAdminValido(cookieValue)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  const { id } = await params

  const { data: forn, error: errGet } = await supabaseAdmin
    .from('leads_fornecedores')
    .select('id, nome, whatsapp, email, aprovacao_status')
    .eq('id', id)
    .maybeSingle()

  if (errGet) return NextResponse.json({ erro: errGet.message }, { status: 500 })
  if (!forn) return NextResponse.json({ erro: 'Fornecedor não encontrado' }, { status: 404 })

  if (forn.aprovacao_status === 'aprovado') {
    return NextResponse.json({ ok: true, ja_aprovado: true })
  }

  const agora = new Date().toISOString()
  const { error: errUpd } = await supabaseAdmin
    .from('leads_fornecedores')
    .update({ aprovacao_status: 'aprovado', aprovacao_em: agora, aprovacao_motivo: null, atualizado_em: agora })
    .eq('id', id)
  if (errUpd) return NextResponse.json({ erro: errUpd.message }, { status: 500 })

  await registrarAudit({
    ator: 'admin',
    acao: 'fornecedor.aprovar',
    entidade_tipo: 'leads_fornecedores',
    entidade_id: id,
    mudancas: { aprovacao_status: { de: forn.aprovacao_status, para: 'aprovado' } },
    metadata: { user_agent: req.headers.get('user-agent') ?? null },
  })

  // Avisa o fornecedor e dispara matching de pedidos órfãos compatíveis.
  if (forn.whatsapp) {
    try {
      await avisoOficial({
        telefone: forn.whatsapp,
        nome: forn.nome ?? null,
        texto: `Boa notícia, ${forn.nome}! 🎉\n\nSeu cadastro no *Confeccione* foi *aprovado* pela nossa equipe.\n\n🎁 *Bônus de boas-vindas:* 90 dias do plano *Pro* — até 30 pedidos por mês nesse período.\n\nA partir de agora você passa a receber pedidos de clientes que combinam com a sua produção. Quando um pedido chegar, é só responder se quer atender. 🚀`,
        resumo: 'Cadastro aprovado! Bônus: 90 dias do plano Pro',
        caminhoBotao: 'fornecedor/entrar',
      })
    } catch (err) {
      console.error('[aprovar] whatsapp falhou:', err)
    }
  }
  if (forn.email) {
    try {
      await emailBoasVindasFornecedor({ email: forn.email, nome: forn.nome })
    } catch (err) {
      console.error('[aprovar] email falhou:', err)
    }
  }

  after(async () => {
    try {
      const r = await matchingRetroativo(id)
      console.log(`[aprovar-callback] fornecedor=${id} ofertasDisparadas=${r.ofertasDisparadas}`)
    } catch (err) {
      console.error(`[aprovar-callback] matchingRetroativo falhou pra ${id}:`, err)
    }
  })

  return NextResponse.json({ ok: true })
}
