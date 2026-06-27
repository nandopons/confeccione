import { getFornecedorId, unauthorized, supabaseAdmin } from '@/lib/mobileAuth';

// GET /api/fornecedor/ofertas — ofertas ABERTAS do fornecedor logado.
// ⚠️ CONTRATO DE PRIVACIDADE: o join com pedidos seleciona SÓ as colunas
// permitidas — nunca nome/whatsapp/email do cliente. O contato só vem no /aceitar.
const PEDIDO_COLS_PUBLICAS = 'tipo, quantidade, prazo, estado, descricao';

export async function GET(req: Request) {
  const fornecedorId = await getFornecedorId(req);
  if (!fornecedorId) return unauthorized();

  const { data, error } = await supabaseAdmin
    .from('ofertas')
    .select(
      `id, pedido_id, status, expira_em, tentativa_numero, tipo_oferta,
       pedido:pedidos!inner(${PEDIDO_COLS_PUBLICAS})`,
    )
    .eq('fornecedor_id', fornecedorId)
    .eq('status', 'enviada') // CONFIRMAR: valor de "oferta aberta" no enum de status
    .gt('expira_em', new Date().toISOString())
    .order('expira_em', { ascending: true });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const ofertas = (data ?? []).map((o: any) => ({
    id: o.id,
    pedido_id: o.pedido_id,
    expira_em: o.expira_em,
    tentativa_numero: o.tentativa_numero,
    tipo_oferta: o.tipo_oferta,
    tipo: o.pedido?.tipo,
    quantidade: o.pedido?.quantidade,
    prazo: o.pedido?.prazo,
    estado: o.pedido?.estado,
    descricao: o.pedido?.descricao,
  }));

  return Response.json(ofertas);
}
