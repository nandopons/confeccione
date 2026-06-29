import { getFornecedorId, unauthorized, supabaseAdmin } from '@/lib/mobileAuth';
import {
  MENSAGEM_SELECT,
  type MensagemRow,
  enviarMidia,
  publicarMensagens,
} from '@/app/lib/mensagens-anexos';

// Chat in-app do pedido (lado FORNECEDOR).
//   GET  → lista as mensagens do pedido (cliente + fornecedor), com URL assinada.
//   POST → envia mensagem como fornecedor. JSON { conteudo } (texto) ou
//          multipart { file, tipo?, conteudo?, duracao_ms? } (mídia).
// Só libera se o pedido foi ACEITO por este fornecedor (fornecedor_aceito_id) e
// está em negociação/concluído. Espelha o lado cliente trocando auth + autor.

const STATUS_COM_CONVERSA = ['em_negociacao', 'concluido'];
const CONTEUDO_MAX = 2000;

async function pedidoDoFornecedor(id: string, fornecedorId: string) {
  const { data } = await supabaseAdmin
    .from('pedidos')
    .select('id, status, fornecedor_aceito_id')
    .eq('id', id)
    .eq('fornecedor_aceito_id', fornecedorId)
    .maybeSingle();
  return data;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const fornecedorId = await getFornecedorId(req);
  if (!fornecedorId) return unauthorized();

  const { id } = await params;
  const pedido = await pedidoDoFornecedor(id, fornecedorId);
  if (!pedido) return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });
  if (!STATUS_COM_CONVERSA.includes(pedido.status)) {
    return Response.json({ error: 'Conversa indisponível' }, { status: 409 });
  }

  const { data, error } = await supabaseAdmin
    .from('mensagens_pedido')
    .select(MENSAGEM_SELECT)
    .eq('pedido_id', id)
    .order('criado_em', { ascending: true });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(await publicarMensagens((data ?? []) as MensagemRow[]));
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const fornecedorId = await getFornecedorId(req);
  if (!fornecedorId) return unauthorized();

  const { id } = await params;
  const pedido = await pedidoDoFornecedor(id, fornecedorId);
  if (!pedido) return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });
  if (!STATUS_COM_CONVERSA.includes(pedido.status)) {
    return Response.json({ error: 'Conversa indisponível' }, { status: 409 });
  }

  const contentType = req.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    return enviarMidia(req, id, 'fornecedor');
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
    .insert({ pedido_id: id, autor: 'fornecedor', tipo: 'texto', conteudo })
    .select(MENSAGEM_SELECT)
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  const [msg] = await publicarMensagens([data as MensagemRow]);
  return Response.json(msg, { status: 201 });
}
