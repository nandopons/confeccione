import { getFornecedorId, unauthorized, supabaseAdmin } from '@/lib/mobileAuth';

// GET /api/fornecedor/ofertas/[id] — detalhe de 1 oferta do fornecedor logado.
// ⚠️ NUNCA retorna contato do cliente (nome/whatsapp/email). Só /aceitar libera.
const PEDIDO_COLS_PUBLICAS = 'tipo, quantidade, prazo, estado, descricao';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const fornecedorId = await getFornecedorId(req);
  if (!fornecedorId) return unauthorized();

  const { id } = await params;

  const { data, error } = await supabaseAdmin
    .from('ofertas')
    .select(
      `id, pedido_id, status, expira_em, tentativa_numero, tipo_oferta,
       pedido:pedidos!inner(${PEDIDO_COLS_PUBLICAS})`,
    )
    .eq('id', id)
    .eq('fornecedor_id', fornecedorId) // garante que a oferta é deste fornecedor
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: 'Oferta não encontrada' }, { status: 404 });

  const o: any = data;
  return Response.json({
    id: o.id,
    pedido_id: o.pedido_id,
    status: o.status,
    expira_em: o.expira_em,
    tentativa_numero: o.tentativa_numero,
    tipo_oferta: o.tipo_oferta,
    tipo: o.pedido?.tipo,
    quantidade: o.pedido?.quantidade,
    prazo: o.pedido?.prazo,
    estado: o.pedido?.estado,
    descricao: o.pedido?.descricao,
    // sem nome/whatsapp/email — por design
  });
}
