import { getContaId, unauthorized, supabaseAdmin } from '@/lib/mobileAuth';

// GET /api/cliente/pedidos — lista de pedidos do cliente logado
export async function GET(req: Request) {
  const contaId = await getContaId(req);
  if (!contaId) return unauthorized();

  const { data, error } = await supabaseAdmin
    .from('pedidos')
    .select('id, tipo, quantidade, prazo, estado, status, criado_em, fornecedor_aceito_id')
    .eq('conta_id', contaId)
    .order('criado_em', { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data ?? []);
}
