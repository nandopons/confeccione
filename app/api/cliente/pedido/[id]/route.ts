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

// Editar/excluir só são permitidos ANTES de uma confecção aceitar — depois mudaria
// (ou apagaria) um acordo já em andamento.
async function pedidoDoCliente(id: string, contaId: string) {
  const { data } = await supabaseAdmin
    .from('pedidos')
    .select('id, status')
    .eq('id', id)
    .eq('conta_id', contaId)
    .maybeSingle();
  return data;
}

// PATCH /api/cliente/pedido/[id] — edita o pedido (só enquanto buscando_fornecedor).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const contaId = await getContaId(req);
  if (!contaId) return unauthorized();

  const { id } = await params;
  const pedido = await pedidoDoCliente(id, contaId);
  if (!pedido) return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });
  if (pedido.status !== 'buscando_fornecedor') {
    return Response.json({ error: 'Só dá pra editar enquanto procura uma confecção' }, { status: 409 });
  }

  let body: { tipo?: unknown; quantidade?: unknown; estado?: unknown; prazo?: unknown; descricao?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'payload inválido' }, { status: 400 });
  }

  const upd: Record<string, unknown> = {};
  if (typeof body.tipo === 'string' && body.tipo.trim()) upd.tipo = body.tipo.trim();
  if (typeof body.quantidade === 'number' && body.quantidade > 0) upd.quantidade = body.quantidade;
  if (typeof body.estado === 'string' && body.estado.trim()) upd.estado = body.estado.trim().toUpperCase().slice(0, 2);
  if (typeof body.prazo === 'string' && body.prazo.trim()) upd.prazo = body.prazo.trim();
  if ('descricao' in body) upd.descricao = body.descricao ? String(body.descricao).trim() : null;

  if (Object.keys(upd).length === 0) {
    return Response.json({ error: 'Nada para atualizar' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('pedidos')
    .update(upd)
    .eq('id', id)
    .eq('conta_id', contaId);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

// DELETE /api/cliente/pedido/[id] — exclui o pedido (só enquanto buscando_fornecedor).
// Ofertas e mensagens saem por ON DELETE CASCADE.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const contaId = await getContaId(req);
  if (!contaId) return unauthorized();

  const { id } = await params;
  const pedido = await pedidoDoCliente(id, contaId);
  if (!pedido) return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });
  if (pedido.status !== 'buscando_fornecedor') {
    return Response.json({ error: 'Não dá pra excluir um pedido que já tem confecção' }, { status: 409 });
  }

  const { error } = await supabaseAdmin
    .from('pedidos')
    .delete()
    .eq('id', id)
    .eq('conta_id', contaId);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
