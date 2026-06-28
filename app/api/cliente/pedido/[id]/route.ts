import { getContaId, unauthorized, supabaseAdmin } from '@/lib/mobileAuth';

// GET /api/cliente/pedido/[id] — detalhe de 1 pedido do cliente logado.
// O contato do FORNECEDOR (whatsapp) só é incluído quando o pedido já está
// em negociação/concluído (alguém aceitou) — espelha o contrato de privacidade.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const contaId = await getContaId(req);
  if (!contaId) return unauthorized();

  const { id } = await params;

  const { data: pedido, error } = await supabaseAdmin
    .from('pedidos')
    .select(
      'id, tipo, quantidade, prazo, estado, descricao, status, criado_em, fornecedor_aceito_id, nome, whatsapp, email',
    )
    .eq('id', id)
    .eq('conta_id', contaId) // garante que é do próprio cliente
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!pedido) return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });

  let fornecedor = null;
  const liberou = pedido.status === 'em_negociacao' || pedido.status === 'concluido';
  if (liberou && pedido.fornecedor_aceito_id) {
    const { data: f } = await supabaseAdmin
      .from('leads_fornecedores')
      .select('id, nome, cidade, estado, whatsapp')
      .eq('id', pedido.fornecedor_aceito_id)
      .maybeSingle();
    fornecedor = f ?? null;
  }

  return Response.json({ ...pedido, fornecedor });
}
