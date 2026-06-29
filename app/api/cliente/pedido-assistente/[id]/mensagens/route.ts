import { getContaId, unauthorized, supabaseAdmin } from '@/lib/mobileAuth';
import {
  MENSAGEM_SELECT,
  type MensagemRow,
  enviarMidia,
  publicarMensagens,
} from '@/app/lib/mensagens-anexos';

// Chat in-app do pedido RICO (lado CLIENTE) — tabela mensagens_pedido_assistente.
// Abre quando uma confecção aceitou o pedido (oferta aceita).
const TABLE = 'mensagens_pedido_assistente' as const;
const CONTEUDO_MAX = 2000;

async function pedidoComChat(id: string, contaId: string) {
  const { data: pedido } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, conta_id')
    .eq('id', id)
    .eq('conta_id', contaId)
    .maybeSingle();
  if (!pedido) return { ok: false as const, status: 404, error: 'Pedido não encontrado' };

  const { data: oferta } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('id')
    .eq('pedido_id', id)
    .eq('status', 'aceita')
    .maybeSingle();
  if (!oferta) return { ok: false as const, status: 409, error: 'A conversa abre quando uma confecção aceitar' };

  return { ok: true as const };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const contaId = await getContaId(req);
  if (!contaId) return unauthorized();
  const { id } = await params;

  const gate = await pedidoComChat(id, contaId);
  if (!gate.ok) return Response.json({ error: gate.error }, { status: gate.status });

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select(MENSAGEM_SELECT)
    .eq('pedido_id', id)
    .order('criado_em', { ascending: true });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(await publicarMensagens((data ?? []) as MensagemRow[]));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const contaId = await getContaId(req);
  if (!contaId) return unauthorized();
  const { id } = await params;

  const gate = await pedidoComChat(id, contaId);
  if (!gate.ok) return Response.json({ error: gate.error }, { status: gate.status });

  const contentType = req.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    return enviarMidia(req, id, 'cliente', TABLE);
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
    .insert({ pedido_id: id, autor: 'cliente', tipo: 'texto', conteudo })
    .select(MENSAGEM_SELECT)
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  const [msg] = await publicarMensagens([data as MensagemRow]);
  return Response.json(msg, { status: 201 });
}
