import { getFornecedorId, unauthorized, supabaseAdmin } from '@/lib/mobileAuth';
import {
  MENSAGEM_SELECT,
  type MensagemRow,
  enviarMidia,
  publicarMensagens,
} from '@/app/lib/mensagens-anexos';

// Chat in-app do pedido RICO (lado FORNECEDOR) — mensagens_pedido_assistente.
// Só libera se este fornecedor teve a oferta ACEITA neste pedido.
const TABLE = 'mensagens_pedido_assistente' as const;
const CONTEUDO_MAX = 2000;

async function podeConversar(id: string, fornecedorId: string) {
  const { data } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('id')
    .eq('pedido_id', id)
    .eq('fornecedor_id', fornecedorId)
    .eq('status', 'aceita')
    .maybeSingle();
  return !!data;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const fornecedorId = await getFornecedorId(req);
  if (!fornecedorId) return unauthorized();
  const { id } = await params;

  if (!(await podeConversar(id, fornecedorId)))
    return Response.json({ error: 'Conversa indisponível' }, { status: 409 });

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select(MENSAGEM_SELECT)
    .eq('pedido_id', id)
    .order('criado_em', { ascending: true });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(await publicarMensagens((data ?? []) as MensagemRow[]));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const fornecedorId = await getFornecedorId(req);
  if (!fornecedorId) return unauthorized();
  const { id } = await params;

  if (!(await podeConversar(id, fornecedorId)))
    return Response.json({ error: 'Conversa indisponível' }, { status: 409 });

  const contentType = req.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    return enviarMidia(req, id, 'fornecedor', TABLE);
  }

  let body: { conteudo?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'payload inválido' }, { status: 400 });
  }
  const conteudo = (body.conteudo ?? '').trim();
  if (!conteudo) return Response.json({ error: 'Mensagem vazia' }, { status: 400 });
  if (conteudo.length > CONTEUDO_MAX) return Response.json({ error: 'Mensagem muito longa' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .insert({ pedido_id: id, autor: 'fornecedor', tipo: 'texto', conteudo })
    .select(MENSAGEM_SELECT)
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  const [msg] = await publicarMensagens([data as MensagemRow]);
  return Response.json(msg, { status: 201 });
}
