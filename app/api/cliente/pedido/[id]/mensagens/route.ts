import { getContaId, unauthorized, supabaseAdmin } from '@/lib/mobileAuth';

// Chat in-app do pedido (lado CLIENTE).
//   GET  → lista as mensagens do pedido (cliente + fornecedor).
//   POST → envia uma mensagem como cliente. Body: { conteudo: string }.
// Só libera quando o pedido é do cliente logado E já tem fornecedor (em
// negociação/concluído) — antes do aceite não há com quem conversar.

const STATUS_COM_CONVERSA = ['em_negociacao', 'concluido'];
const CONTEUDO_MAX = 2000;

async function pedidoDoCliente(id: string, contaId: string) {
  const { data } = await supabaseAdmin
    .from('pedidos')
    .select('id, conta_id, status, fornecedor_aceito_id')
    .eq('id', id)
    .eq('conta_id', contaId)
    .maybeSingle();
  return data;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const contaId = await getContaId(req);
  if (!contaId) return unauthorized();

  const { id } = await params;
  const pedido = await pedidoDoCliente(id, contaId);
  if (!pedido) return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });
  if (!STATUS_COM_CONVERSA.includes(pedido.status)) {
    return Response.json({ error: 'A conversa abre quando uma confecção aceita o pedido' }, { status: 409 });
  }

  const { data, error } = await supabaseAdmin
    .from('mensagens_pedido')
    .select('id, autor, conteudo, criado_em')
    .eq('pedido_id', id)
    .order('criado_em', { ascending: true });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data ?? []);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const contaId = await getContaId(req);
  if (!contaId) return unauthorized();

  const { id } = await params;
  const pedido = await pedidoDoCliente(id, contaId);
  if (!pedido) return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });
  if (!STATUS_COM_CONVERSA.includes(pedido.status)) {
    return Response.json({ error: 'A conversa abre quando uma confecção aceita o pedido' }, { status: 409 });
  }

  let body: { conteudo?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'payload inválido' }, { status: 400 });
  }
  const conteudo = (body.conteudo ?? '').trim();
  if (!conteudo) return Response.json({ error: 'Mensagem vazia' }, { status: 400 });
  if (conteudo.length > CONTEUDO_MAX) {
    return Response.json({ error: 'Mensagem muito longa' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('mensagens_pedido')
    .insert({ pedido_id: id, autor: 'cliente', conteudo })
    .select('id, autor, conteudo, criado_em')
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data, { status: 201 });
}
