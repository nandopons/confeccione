import { getFornecedorId, unauthorized, supabaseAdmin } from '@/lib/mobileAuth';

// GET /api/fornecedor/oferta-assistente/[id] — detalhe da oferta RICA (por
// modelo). SEM PII do cliente: só a composição do pedido + UF pra logística.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const { data: p } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('categoria, prazo_dias, uf, cidade, cep, linhas')
    .eq('id', oferta.pedido_id)
    .maybeSingle();

  // CEP/cidade liberados pré-pagamento só pra cotação de frete (Melhor Envio).
  // Rua/número/complemento e contato seguem protegidos até o pagamento (D5).
  return Response.json({
    id: oferta.id,
    pedido_id: oferta.pedido_id,
    status: oferta.status,
    categoria: p?.categoria ?? null,
    prazo_dias: p?.prazo_dias ?? null,
    uf: p?.uf ?? null,
    cidade: p?.cidade ?? null,
    cep: p?.cep ?? null,
    linhas: Array.isArray(p?.linhas) ? p?.linhas : [],
  });
}
