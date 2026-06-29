import { getFornecedorId, unauthorized, supabaseAdmin } from '@/lib/mobileAuth';
import { primeiroNome } from '@/app/lib/nome';

// GET /api/fornecedor/conversas — só os pedidos ACEITOS por este fornecedor que
// já têm mensagem (chat iniciado), com prévia da última mensagem.
type LinhaResumo = { total?: number };
type Msg = { pedido_id: string; conteudo: string | null; tipo: string; autor: string; criado_em: string };

function previa(m: Msg): string {
  if (m.tipo === 'audio') return '🎤 Áudio';
  if (m.tipo === 'imagem') return '🖼️ Imagem';
  if (m.tipo === 'arquivo') return '📎 Arquivo';
  return m.conteudo ?? '';
}

export async function GET(req: Request) {
  const fornecedorId = await getFornecedorId(req);
  if (!fornecedorId) return unauthorized();

  const { data: aceitas } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('pedido_id')
    .eq('fornecedor_id', fornecedorId)
    .eq('status', 'aceita');

  const ids = [...new Set((aceitas ?? []).map((o) => o.pedido_id))];
  if (!ids.length) return Response.json([]);

  const { data: msgs } = await supabaseAdmin
    .from('mensagens_pedido_assistente')
    .select('pedido_id, conteudo, tipo, autor, criado_em')
    .in('pedido_id', ids)
    .order('criado_em', { ascending: false });

  // Última mensagem por pedido (msgs já vem desc).
  const ultima = new Map<string, Msg>();
  for (const m of (msgs ?? []) as Msg[]) {
    if (!ultima.has(m.pedido_id)) ultima.set(m.pedido_id, m);
  }
  const comChat = [...ultima.keys()];
  if (!comChat.length) return Response.json([]);

  const { data: pedidos } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, categoria, nome, uf, cidade, linhas')
    .in('id', comChat);
  const pById = new Map((pedidos ?? []).map((p) => [p.id, p]));

  const lista = comChat
    .map((pid) => {
      const m = ultima.get(pid)!;
      const p = pById.get(pid);
      const linhas: LinhaResumo[] = Array.isArray(p?.linhas) ? p!.linhas : [];
      return {
        pedido_id: pid,
        categoria: p?.categoria ?? null,
        cliente_nome: primeiroNome(p?.nome ?? '') || null, // só 1º nome (contato completo segue protegido até o pagamento)
        cidade: p?.cidade ?? null,
        uf: p?.uf ?? null,
        n_modelos: linhas.length,
        total_pecas: linhas.reduce((s, l) => s + (l.total ?? 0), 0),
        ultima_msg: previa(m),
        ultima_autor: m.autor,
        ultima_em: m.criado_em,
      };
    })
    .sort((a, b) => (a.ultima_em < b.ultima_em ? 1 : -1));

  return Response.json(lista);
}
