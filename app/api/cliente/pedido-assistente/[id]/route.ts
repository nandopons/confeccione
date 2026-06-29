import { getContaId, unauthorized, supabaseAdmin } from '@/lib/mobileAuth';
import { aplicarEdicaoLinhas, STATUS_BLOQUEADO } from '@/app/lib/editar-pedido-assistente';

// GET /api/cliente/pedido-assistente/[id] — detalhe do pedido RICO (por modelo)
// do cliente logado. Mapeia pedidos_assistente pro shape PedidoRico do app.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const contaId = await getContaId(req);
  if (!contaId) return unauthorized();

  const { id } = await params;
  const { data: p, error } = await supabaseAdmin
    .from('pedidos_assistente')
    .select(
      'id, codigo, categoria, status, criado_em, prazo_dias, linhas, cep, logradouro, numero, complemento, bairro, cidade, uf, orcamento_status, valor_centavos, repasse_centavos, frete_centavos, orcamento_itens',
    )
    .eq('id', id)
    .eq('conta_id', contaId)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!p) return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });

  // valor_centavos (coluna) = preço do cliente cobrado pelo ASAAS (líquido + Seguro 3%).
  // itens = detalhamento por modelo + extras + seguro (quando há); null = orçamento antigo.
  const orcamento = p.orcamento_status
    ? { status: p.orcamento_status, valor_centavos: p.valor_centavos ?? p.repasse_centavos ?? null, frete_centavos: p.frete_centavos ?? null, itens: p.orcamento_itens ?? null }
    : { status: 'pendente', valor_centavos: null, frete_centavos: null, itens: null };

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

// PATCH /api/cliente/pedido-assistente/[id] — cliente dono edita as linhas/prazo
// durante o alinhamento. Bloqueado depois do orçamento fechado (D2).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const contaId = await getContaId(req);
  if (!contaId) return unauthorized();

  const { id } = await params;
  const { data: p } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, status, orcamento_status')
    .eq('id', id)
    .eq('conta_id', contaId)
    .maybeSingle();
  if (!p) return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });
  if (STATUS_BLOQUEADO.has(p.status ?? '')) {
    return Response.json({ error: 'Este pedido já foi finalizado.' }, { status: 409 });
  }

  return aplicarEdicaoLinhas(req, id, p.orcamento_status);
}
