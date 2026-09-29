/**
 * GET    /api/admin/fornecedores/[id]   — detalhes + métricas + histórico
 * PATCH  /api/admin/fornecedores/[id]   — edita campos permitidos + audit
 *
 * Métricas calculadas (das duas eras de oferta — ver admin-fornecedor-ofertas.ts):
 *   - ofertas_aceitas: count(ofertas where status='aceita')
 *   - taxa_resposta: (aceitas + recusadas) / (enviadas - expiradas)
 *   - ultima_oferta_em: max(enviada_em)
 *   - perdeu_para_outro: pedidos ofertados onde outro fornecedor foi aceito
 *
 * PATCH whitelist: nome, whatsapp, email, cidade, estado, pecas (tipos_produto
 * é derivado delas), pecas_outro,
 *                  raio_atendimento, pedido_minimo
 * Status NÃO é editável aqui — usar /pausar e /reativar.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { legadoDasPecas, pecaValida } from '@/app/lib/pecas'
import { registrarAudit, diffMudancas } from '@/app/lib/audit'
import { metricasDasOfertas, ofertasDoFornecedor } from '@/app/lib/admin-fornecedor-ofertas'

const CAMPOS_EDITAVEIS = [
  'nome',
  'whatsapp',
  'email',
  'cidade',
  'estado',
  'pecas',
  'pecas_outro',
  'raio_atendimento',
  'pedido_minimo',
] as const

const RAIOS_VALIDOS = new Set(['cidade', 'estado', 'regiao', 'nacional'])

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const cookieValue = req.cookies.get(COOKIE_ADMIN)?.value
  if (!ehTokenAdminValido(cookieValue)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  const { id } = await params

  const { data: fornecedor, error: errF } = await supabaseAdmin
    .from('leads_fornecedores')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (errF) return NextResponse.json({ erro: errF.message }, { status: 500 })
  if (!fornecedor) {
    return NextResponse.json({ erro: 'Fornecedor não encontrado' }, { status: 404 })
  }

  // As duas eras de oferta (ver admin-fornecedor-ofertas.ts): o card lia só
  // `ofertas` (fluxo antigo, parado desde maio) e mostrava "última oferta: 4
  // meses atrás" pra quem tinha recebido oferta de manhã.
  let metricas
  try {
    metricas = metricasDasOfertas(id, await ofertasDoFornecedor(id))
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'falha ao ler ofertas' }, { status: 500 })
  }

  return NextResponse.json({ fornecedor, metricas })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const cookieValue = req.cookies.get(COOKIE_ADMIN)?.value
  if (!ehTokenAdminValido(cookieValue)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ erro: 'Body JSON inválido' }, { status: 400 })
  }

  const atualizacao: Record<string, unknown> = {}
  for (const campo of CAMPOS_EDITAVEIS) {
    if (campo in body) atualizacao[campo] = body[campo]
  }

  if (Object.keys(atualizacao).length === 0) {
    return NextResponse.json(
      { erro: 'Nenhum campo editável no body' },
      { status: 400 },
    )
  }

  if ('raio_atendimento' in atualizacao) {
    const v = atualizacao.raio_atendimento
    if (typeof v !== 'string' || !RAIOS_VALIDOS.has(v)) {
      return NextResponse.json(
        { erro: `raio_atendimento inválido: ${v}` },
        { status: 400 },
      )
    }
  }
  if ('pedido_minimo' in atualizacao) {
    const v = atualizacao.pedido_minimo
    if (!Number.isInteger(v) || (v as number) < 0) {
      return NextResponse.json(
        { erro: 'pedido_minimo deve ser inteiro >= 0' },
        { status: 400 },
      )
    }
  }
  if ('pecas' in atualizacao) {
    const v = atualizacao.pecas
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
      return NextResponse.json(
        { erro: 'pecas deve ser array de strings' },
        { status: 400 },
      )
    }
    const limpas = [...new Set(v.filter(pecaValida))]
    atualizacao.pecas = limpas
    // tipos_produto não é mais editável à mão: é derivado das peças, senão os
    // dois divergem e o fornecedor fica visível por um caminho e invisível pelo
    // outro. Só sobrescreve quando há peça marcada — zerar tiraria da ponte
    // quem ainda não migrou.
    if (limpas.length > 0) atualizacao.tipos_produto = legadoDasPecas(limpas)
  }

  const { data: antes, error: errBefore } = await supabaseAdmin
    .from('leads_fornecedores')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (errBefore) return NextResponse.json({ erro: errBefore.message }, { status: 500 })
  if (!antes) return NextResponse.json({ erro: 'Fornecedor não encontrado' }, { status: 404 })

  atualizacao.atualizado_em = new Date().toISOString()
  const { data: depois, error: errUpd } = await supabaseAdmin
    .from('leads_fornecedores')
    .update(atualizacao)
    .eq('id', id)
    .select('*')
    .single()

  if (errUpd) return NextResponse.json({ erro: errUpd.message }, { status: 500 })

  await registrarAudit({
    ator: 'admin',
    acao: 'fornecedor.editar',
    entidade_tipo: 'leads_fornecedores',
    entidade_id: id,
    mudancas: diffMudancas(antes, depois),
    metadata: { user_agent: req.headers.get('user-agent') ?? null },
  })

  return NextResponse.json({ ok: true, fornecedor: depois })
}
