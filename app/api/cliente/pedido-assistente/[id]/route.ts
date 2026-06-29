import { getContaId, unauthorized, supabaseAdmin } from '@/lib/mobileAuth';

// GET /api/cliente/pedido-assistente/[id] — detalhe do pedido RICO (por modelo)
// do cliente logado. Mapeia pedidos_assistente pro shape PedidoRico do app.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const contaId = await getContaId(req);
  if (!contaId) return unauthorized();

  const { id } = await params;
  const { data: p, error } = await supabaseAdmin
    .from('pedidos_assistente')
    .select(
      'id, codigo, categoria, status, criado_em, prazo_dias, linhas, cep, logradouro, numero, complemento, bairro, cidade, uf, orcamento_status, repasse_centavos, frete_centavos',
    )
    .eq('id', id)
    .eq('conta_id', contaId)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!p) return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });

  const orcamento = p.orcamento_status
    ? { status: p.orcamento_status, valor_centavos: p.repasse_centavos ?? null, frete_centavos: p.frete_centavos ?? null }
    : { status: 'pendente', valor_centavos: null, frete_centavos: null };

  // Chat abre quando uma confecção aceitou o pedido.
  const { data: ofertaAceita } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('id')
    .eq('pedido_id', id)
    .eq('status', 'aceita')
    .maybeSingle();

  return Response.json({
    chat_aberto: !!ofertaAceita,
    id: p.id,
    codigo: p.codigo ?? null,
    categoria: p.categoria,
    status: p.status,
    criado_em: p.criado_em,
    prazo_dias: p.prazo_dias,
    linhas: Array.isArray(p.linhas) ? p.linhas : [],
    mockups: [],
    endereco: {
      cep: p.cep,
      logradouro: p.logradouro,
      numero: p.numero,
      complemento: p.complemento,
      bairro: p.bairro,
      cidade: p.cidade,
      uf: p.uf,
    },
    orcamento,
    fornecedor: null,
  });
}
