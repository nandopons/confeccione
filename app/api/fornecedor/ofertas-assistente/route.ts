import { getFornecedorId, unauthorized, supabaseAdmin } from '@/lib/mobileAuth';

// GET /api/fornecedor/ofertas-assistente — ofertas RICAS abertas (status
// 'ofertada') do fornecedor logado. SEM PII do cliente (pré-aceite).
type LinhaResumo = { total?: number };

export async function GET(req: Request) {
  const fornecedorId = await getFornecedorId(req);
  if (!fornecedorId) return unauthorized();

  const { data: ofertas, error } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('id, pedido_id, criado_em')
    .eq('fornecedor_id', fornecedorId)
    .eq('status', 'ofertada')
    .order('criado_em', { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const ids = [...new Set((ofertas ?? []).map((o) => o.pedido_id))];
  const pedidosById = new Map<string, { categoria: string | null; prazo_dias: number | null; linhas: LinhaResumo[] }>();
  if (ids.length) {
    const { data: pedidos } = await supabaseAdmin
      .from('pedidos_assistente')
      .select('id, categoria, prazo_dias, linhas')
      .in('id', ids);
    for (const p of pedidos ?? []) {
      pedidosById.set(p.id, {
        categoria: p.categoria,
        prazo_dias: p.prazo_dias,
        linhas: Array.isArray(p.linhas) ? p.linhas : [],
      });
    }
  }

  const lista = (ofertas ?? []).map((o) => {
    const p = pedidosById.get(o.pedido_id);
    const linhas = p?.linhas ?? [];
    return {
      id: o.id,
      pedido_id: o.pedido_id,
      categoria: p?.categoria ?? null,
      prazo_dias: p?.prazo_dias ?? null,
      n_modelos: linhas.length,
      total_pecas: linhas.reduce((s, l) => s + (l.total ?? 0), 0),
      criado_em: o.criado_em,
    };
  });

  return Response.json(lista);
}
