import { getContaId, unauthorized, supabaseAdmin } from '@/lib/mobileAuth';
import { getPortfolio } from '@/app/lib/portfolio-fornecedor';

// GET /api/cliente/fornecedor/[id] — vitrine pública da confecção, visível pro
// cliente (nome, CNPJ, cidade, instagram, site, descrição, portfólio).
// Exige cliente autenticado; só expõe dados de vitrine (sem PII de cota/banco).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const contaId = await getContaId(req);
  if (!contaId) return unauthorized();

  const { id } = await params;

  const { data: f, error } = await supabaseAdmin
    .from('leads_fornecedores')
    .select('id, nome, cidade, estado, cpf_cnpj, whatsapp, instagram, site, descricao_livre')
    .eq('id', id)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!f) return Response.json({ error: 'Confecção não encontrada' }, { status: 404 });

  const portfolio = await getPortfolio(id);

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
    portfolio,
  });
}
