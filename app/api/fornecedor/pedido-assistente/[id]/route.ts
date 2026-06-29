import { getFornecedorId, unauthorized, supabaseAdmin } from '@/lib/mobileAuth';
import { primeiroNome } from '@/app/lib/nome';
import { aplicarEdicaoLinhas, STATUS_BLOQUEADO } from '@/app/lib/editar-pedido-assistente';

// GET /api/fornecedor/pedido-assistente/[id] — contexto do pedido pro fornecedor
// que ACEITOU (resumo do pedido + norte no chat). Só PRIMEIRO NOME do cliente +
// UF/cidade/CEP (frete); WhatsApp/endereço completo seguem protegidos (D5).
type LinhaResumo = { total?: number };

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const fornecedorId = await getFornecedorId(req);
  if (!fornecedorId) return unauthorized();

  const { id } = await params;
  const { data: oferta } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('id')
    .eq('pedido_id', id)
    .eq('fornecedor_id', fornecedorId)
    .eq('status', 'aceita')
    .maybeSingle();
  if (!oferta) return Response.json({ error: 'Você não está nesta negociação' }, { status: 409 });

  const { data: p, error } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, nome, uf, cidade, cep, categoria, prazo_dias, status, orcamento_status, repasse_centavos, frete_centavos, orcamento_itens, linhas')
    .eq('id', id)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!p) return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });

  const linhas: LinhaResumo[] = Array.isArray(p.linhas) ? p.linhas : [];
  // Pro fornecedor, valor_centavos = repasse (LÍQUIDO que ele recebe). itens traz
  // o detalhamento (produção por modelo + extras + frete, líquidos).
  const orcamento = p.orcamento_status
    ? { status: p.orcamento_status, valor_centavos: p.repasse_centavos ?? null, frete_centavos: p.frete_centavos ?? null, itens: p.orcamento_itens ?? null }
    : { status: 'pendente', valor_centavos: null, frete_centavos: null, itens: null };

  return Response.json({
    pedido_id: p.id,
    cliente_nome: primeiroNome(p.nome ?? '') || 'Cliente',
    uf: p.uf ?? null,
    cidade: p.cidade ?? null,
    cep: p.cep ?? null,
    categoria: p.categoria ?? null,
    prazo_dias: p.prazo_dias ?? null,
    total_pecas: linhas.reduce((s, l) => s + (l.total ?? 0), 0),
    linhas: p.linhas,
    orcamento,
    status: p.status,
  });
}

// PATCH /api/fornecedor/pedido-assistente/[id] — fornecedor que ACEITOU edita as
// linhas/prazo durante o alinhamento. Bloqueado depois do orçamento fechado (D2).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const fornecedorId = await getFornecedorId(req);
  if (!fornecedorId) return unauthorized();

  const { id } = await params;
  const { data: oferta } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('id')
    .eq('pedido_id', id)
    .eq('fornecedor_id', fornecedorId)
    .eq('status', 'aceita')
    .maybeSingle();
  if (!oferta) return Response.json({ error: 'Você não está nesta negociação' }, { status: 409 });

  const { data: p } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, status, orcamento_status')
    .eq('id', id)
    .maybeSingle();
  if (!p) return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });
  if (STATUS_BLOQUEADO.has(p.status ?? '')) {
    return Response.json({ error: 'Este pedido já foi finalizado.' }, { status: 409 });
  }

  return aplicarEdicaoLinhas(req, id, p.orcamento_status);
}
