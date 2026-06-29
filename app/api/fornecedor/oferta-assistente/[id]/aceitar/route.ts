import { getFornecedorId, unauthorized, supabaseAdmin } from '@/lib/mobileAuth';

// POST /api/fornecedor/oferta-assistente/[id]/aceitar
// Fornecedor aceita a oferta rica → abre o chat. NÃO libera contato do cliente
// (D5: contato só após o cliente aprovar o orçamento e pagar).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const fornecedorId = await getFornecedorId(req);
  if (!fornecedorId) return unauthorized();

  const { id } = await params;
  const { data: oferta, error } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('id, pedido_id, status')
    .eq('id', id)
    .eq('fornecedor_id', fornecedorId)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!oferta) return Response.json({ error: 'Oferta não encontrada' }, { status: 404 });
  if (oferta.status !== 'ofertada' && oferta.status !== 'aceita') {
    return Response.json({ error: 'Esta oferta não está mais disponível' }, { status: 409 });
  }

  const agora = new Date().toISOString();

  // Aceita esta oferta.
  const { error: upErr } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .update({ status: 'aceita', respondido_em: agora })
    .eq('id', id);
  if (upErr) return Response.json({ error: upErr.message }, { status: 500 });

  // Cancela as outras ofertas abertas do mesmo pedido (um fornecedor por pedido).
  await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .update({ status: 'cancelada', respondido_em: agora })
    .eq('pedido_id', oferta.pedido_id)
    .eq('status', 'ofertada')
    .neq('id', id);

  // Pedido entra em alinhamento (chat aberto, antes do orçamento).
  await supabaseAdmin
    .from('pedidos_assistente')
    .update({ status: 'em_alinhamento' })
    .eq('id', oferta.pedido_id);

  return Response.json({ ok: true, pedido_id: oferta.pedido_id });
}
