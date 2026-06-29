import { getFornecedorId, unauthorized, supabaseAdmin } from '@/lib/mobileAuth';

// POST /api/fornecedor/pedido-assistente/[id]/orcar
// Fornecedor (que aceitou) envia/atualiza o orçamento: repasse + frete (+ prazo,
// observação). Pedido vai pra "orcado". Reenviável enquanto não pago.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const fornecedorId = await getFornecedorId(req);
  if (!fornecedorId) return unauthorized();

  const { id } = await params; // pedido_id
  const { data: oferta } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('id, status')
    .eq('pedido_id', id)
    .eq('fornecedor_id', fornecedorId)
    .eq('status', 'aceita')
    .maybeSingle();
  if (!oferta) return Response.json({ error: 'Você não está nesta negociação' }, { status: 409 });

  let body: { repasse_centavos?: number; frete_centavos?: number; prazo_dias?: number; observacao?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'payload inválido' }, { status: 400 });
  }

  const repasse = Math.round(Number(body.repasse_centavos));
  if (!Number.isFinite(repasse) || repasse <= 0) {
    return Response.json({ error: 'Informe o valor do orçamento' }, { status: 400 });
  }
  const frete = Number.isFinite(Number(body.frete_centavos)) ? Math.round(Number(body.frete_centavos)) : 0;
  const prazoDias = Number.isFinite(Number(body.prazo_dias)) ? Math.round(Number(body.prazo_dias)) : null;
  const observacao = typeof body.observacao === 'string' ? body.observacao.trim() || null : null;

  const { error: ofErr } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .update({ valor_repasse_centavos: repasse, observacao })
    .eq('id', oferta.id);
  if (ofErr) return Response.json({ error: ofErr.message }, { status: 500 });

  const patch: Record<string, unknown> = {
    orcamento_status: 'definido',
    repasse_centavos: repasse,
    frete_centavos: frete,
    orcamento_definido_em: new Date().toISOString(),
    status: 'orcado',
  };
  if (prazoDias != null) patch.prazo_dias = prazoDias;

  const { error: pErr } = await supabaseAdmin.from('pedidos_assistente').update(patch).eq('id', id);
  if (pErr) return Response.json({ error: pErr.message }, { status: 500 });

  return Response.json({ ok: true });
}
