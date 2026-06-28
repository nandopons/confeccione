import { getFornecedorId, unauthorized, supabaseAdmin } from '@/lib/mobileAuth';

// GET /api/fornecedor/historico — ofertas passadas do fornecedor logado.
// Mapeia o status da oferta para resultado: aceito | recusou | expirou.
// Continua SEM contato do cliente (mesmo já tendo aceito, este endpoint não expõe).
const PEDIDO_COLS_PUBLICAS = 'tipo, quantidade, estado';

const RESULTADO: Record<string, 'aceito' | 'recusou' | 'expirou'> = {
  aceita: 'aceito',
  recusada: 'recusou',
  expirada: 'expirou',
};

export async function GET(req: Request) {
  const fornecedorId = await getFornecedorId(req);
  if (!fornecedorId) return unauthorized();

  const { data, error } = await supabaseAdmin
    .from('ofertas')
    .select(
      `id, pedido_id, status, respondida_em, enviada_em,
       pedido:pedidos!inner(${PEDIDO_COLS_PUBLICAS})`,
    )
    .eq('fornecedor_id', fornecedorId)
    .in('status', ['aceita', 'recusada', 'expirada']) // CONFIRMAR enum
    .order('respondida_em', { ascending: false, nullsFirst: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const itens = (data ?? []).map((o: any) => ({
    id: o.id,
    pedido_id: o.pedido_id,
    resultado: RESULTADO[o.status] ?? 'expirou',
    data: o.respondida_em ?? o.enviada_em,
    tipo: o.pedido?.tipo,
    quantidade: o.pedido?.quantidade,
    estado: o.pedido?.estado,
  }));

  return Response.json(itens);
}
