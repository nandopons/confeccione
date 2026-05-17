// app/api/fornecedor/ofertas/[id]/recusar/route.ts
// ============================================================================
// API: recusar uma oferta pelo painel do fornecedor (alternativa ao NAO via WA).
//
// FLUXO (replica a lógica do webhook quando o fornecedor responde NAO):
//   1. Valida sessão do fornecedor logado
//   2. Valida que a oferta existe, pertence ao fornecedor logado, e está pendente
//   3. UPDATE oferta: status = 'recusada'
//   4. Notifica fornecedor (WhatsApp) — best effort
//   5. Dispara próximo fornecedor via criarEDispararOferta — best effort
//
// SEGURANÇA:
//   - Só recusa ofertas com status='enviada'
//   - Garante que fornecedor_id da oferta == fornecedor logado
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getFornecedorAtual } from '@/app/lib/auth-server'
import { enviarMensagem } from '@/app/lib/zapi'
import { criarEDispararOferta } from '@/app/lib/ofertas'
import { processarProximaAgendadaSeHouver } from '@/app/lib/fila'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // 1. Autenticação
  const fornecedor = await getFornecedorAtual()
  if (!fornecedor) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  if (fornecedor.status === 'inativo') {
    return NextResponse.json(
      { erro: 'Conta inativa. Entre em contato com o suporte.' },
      { status: 403 }
    )
  }

  const { id: ofertaId } = await params

  // 2. Valida oferta
  const { data: oferta, error: ofertaErr } = await supabase
    .from('ofertas')
    .select('id, fornecedor_id, pedido_id, status, expira_em, tipo_oferta')
    .eq('id', ofertaId)
    .single()

  if (ofertaErr || !oferta) {
    return NextResponse.json({ erro: 'Oferta não encontrada' }, { status: 404 })
  }

  if (oferta.fornecedor_id !== fornecedor.id) {
    return NextResponse.json({ erro: 'Sem permissão' }, { status: 403 })
  }

  if (oferta.status !== 'enviada') {
    return NextResponse.json(
      { erro: 'Esta oferta já foi processada' },
      { status: 409 }
    )
  }

  if (oferta.tipo_oferta !== 'normal') {
    return NextResponse.json(
      { erro: 'Tipo de oferta não suportado pelo painel' },
      { status: 400 }
    )
  }

  // 3. Busca whatsapp do fornecedor (pra notificar)
  const { data: fornecedorCompleto } = await supabase
    .from('leads_fornecedores')
    .select('whatsapp')
    .eq('id', fornecedor.id)
    .single()

  // 4. UPDATE oferta → recusada
  const { error: updateErr } = await supabase
    .from('ofertas')
    .update({ status: 'recusada', respondida_em: new Date().toISOString() })
    .eq('id', oferta.id)

  if (updateErr) {
    console.error('recusar: erro ao atualizar oferta', updateErr)
    return NextResponse.json({ erro: 'Erro ao processar' }, { status: 500 })
  }

  // 5. Notifica fornecedor (WhatsApp) — best effort
  if (fornecedorCompleto?.whatsapp) {
    try {
      await enviarMensagem(
        fornecedorCompleto.whatsapp,
        'Ok, sem problema! Vamos oferecer pra outro fornecedor.'
      )
    } catch (err) {
      console.error('recusar: aviso fornecedor whatsapp falhou:', err)
    }
  }

  // 6. Dispara próximo fornecedor — best effort
  try {
    await criarEDispararOferta(oferta.pedido_id)
  } catch (err) {
    console.error('recusar: reenvio para próximo fornecedor falhou:', err)
  }

  // 7. Acorda fila de reenvios do fornecedor que recusou (B3). Failure-soft.
  try {
    await processarProximaAgendadaSeHouver(fornecedor.id)
  } catch (err) {
    console.error('[recusar] processar fila falhou:', err)
  }

  return NextResponse.json({ ok: true })
}
