import { getFornecedorId, unauthorized, supabaseAdmin } from '@/lib/mobileAuth';

// GET /api/fornecedor/conta — plano, cota e gating do fornecedor logado.
export async function GET(req: Request) {
  const fornecedorId = await getFornecedorId(req);
  if (!fornecedorId) return unauthorized();

  const { data: f, error } = await supabaseAdmin
    .from('leads_fornecedores')
    .select(
      'id, nome, cidade, estado, plano, plano_expira_em, creditos_extras, aprovacao_status, pausado_em',
    )
    .eq('id', fornecedorId)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!f) return Response.json({ error: 'Fornecedor não encontrado' }, { status: 404 });

  // Soma dos créditos avulsos ainda disponíveis e não expirados (FIFO no consumo).
  const { data: creditos } = await supabaseAdmin
    .from('creditos_avulsos')
    .select('quantidade_disponivel, expira_em, esgotado_em')
    .eq('fornecedor_id', fornecedorId)
    .is('esgotado_em', null)
    .gt('expira_em', new Date().toISOString());

  const creditos_avulsos_disponiveis = (creditos ?? []).reduce(
    (sum: number, c: any) => sum + (c.quantidade_disponivel ?? 0),
    0,
  );

  return Response.json({ ...f, creditos_avulsos_disponiveis });
}
