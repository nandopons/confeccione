import { getFornecedorId, unauthorized, supabaseAdmin } from '@/lib/mobileAuth';
import { getPortfolio } from '@/app/lib/portfolio-fornecedor';

// GET /api/fornecedor/conta — perfil/vitrine do fornecedor logado.
//   (Sem plano/créditos — monetização é por comissão no pedido.)
export async function GET(req: Request) {
  const fornecedorId = await getFornecedorId(req);
  if (!fornecedorId) return unauthorized();

  const { data: f, error } = await supabaseAdmin
    .from('leads_fornecedores')
    .select(
      'id, nome, cidade, estado, cpf_cnpj, whatsapp, instagram, site, descricao_livre, aprovacao_status, pausado_em',
    )
    .eq('id', fornecedorId)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!f) return Response.json({ error: 'Fornecedor não encontrado' }, { status: 404 });

  const portfolio = await getPortfolio(fornecedorId);

  return Response.json({
    id: f.id,
    nome: f.nome,
    cidade: f.cidade,
    estado: f.estado,
    cnpj: f.cpf_cnpj,
    whatsapp: f.whatsapp,
    instagram: f.instagram,
    site: f.site,
    descricao: f.descricao_livre,
    aprovacao_status: f.aprovacao_status,
    pausado_em: f.pausado_em,
    portfolio,
  });
}

// PATCH /api/fornecedor/conta — atualiza o perfil/vitrine.
// Aceita { nome?, cnpj?, whatsapp?, instagram?, site?, descricao? }.
const CAMPOS: Record<string, string> = {
  nome: 'nome',
  whatsapp: 'whatsapp',
  instagram: 'instagram',
  site: 'site',
  cnpj: 'cpf_cnpj',
  descricao: 'descricao_livre',
};

export async function PATCH(req: Request) {
  const fornecedorId = await getFornecedorId(req);
  if (!fornecedorId) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'payload inválido' }, { status: 400 });
  }

  const update: Record<string, string> = {};
  for (const [campo, coluna] of Object.entries(CAMPOS)) {
    const v = body[campo];
    if (typeof v === 'string') update[coluna] = v.trim();
  }
  if (Object.keys(update).length === 0) {
    return Response.json({ error: 'nada para atualizar' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('leads_fornecedores')
    .update(update)
    .eq('id', fornecedorId);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
