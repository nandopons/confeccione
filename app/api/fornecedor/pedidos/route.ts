import { getFornecedorId, unauthorized, supabaseAdmin } from '@/lib/mobileAuth';

// GET /api/fornecedor/pedidos — TODOS os pedidos/ofertas do fornecedor logado
// (unifica "Ofertas" + "Histórico"). SEM PII do cliente. Inclui repasse/frete
// pra Carteira.
type LinhaResumo = { total?: number };

function statusForn(
  oferta: string,
  pedido: string | null,
): 'aberta' | 'em_andamento' | 'concluido' | 'encerrado' {
  if (oferta === 'ofertada') return 'aberta';
  if (oferta === 'aceita') {
    if (pedido === 'fechado' || pedido === 'concluido' || pedido === 'completo') return 'concluido';
    return 'em_andamento';
  }
  return 'encerrado'; // recusada | cancelada | expirada
}

export async function GET(req: Request) {
  const fornecedorId = await getFornecedorId(req);
  if (!fornecedorId) return unauthorized();

  const { data: ofertas, error } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('id, pedido_id, status, valor_repasse_centavos, repasse_status, criado_em')
    .eq('fornecedor_id', fornecedorId)
    .order('criado_em', { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const ids = [...new Set((ofertas ?? []).map((o) => o.pedido_id))];
  const byId = new Map<
    string,
    { categoria: string | null; prazo_dias: number | null; status: string | null; orcamento_status: string | null; repasse_centavos: number | null; frete_centavos: number | null; linhas: LinhaResumo[] }
  >();
  if (ids.length) {
    const { data: pedidos } = await supabaseAdmin
      .from('pedidos_assistente')
      .select('id, categoria, prazo_dias, status, orcamento_status, repasse_centavos, frete_centavos, linhas')
      .in('id', ids);
    for (const p of pedidos ?? []) {
      byId.set(p.id, {
        categoria: p.categoria,
        prazo_dias: p.prazo_dias,
        status: p.status,
        orcamento_status: p.orcamento_status,
        repasse_centavos: p.repasse_centavos,
        frete_centavos: p.frete_centavos,
        linhas: Array.isArray(p.linhas) ? p.linhas : [],
      });
    }
  }

  const lista = (ofertas ?? []).map((o) => {
    const p = byId.get(o.pedido_id);
    const linhas = p?.linhas ?? [];
    return {
      oferta_id: o.id,
      pedido_id: o.pedido_id,
      status: statusForn(o.status, p?.status ?? null),
      categoria: p?.categoria ?? null,
      prazo_dias: p?.prazo_dias ?? null,
      n_modelos: linhas.length,
      total_pecas: linhas.reduce((s, l) => s + (l.total ?? 0), 0),
      criado_em: o.criado_em,
      orcamento_status: p?.orcamento_status ?? null,
      repasse_centavos: p?.repasse_centavos ?? o.valor_repasse_centavos ?? null,
      frete_centavos: p?.frete_centavos ?? null,
      repasse_status: o.repasse_status ?? null,
    };
  });

  return Response.json(lista);
}
