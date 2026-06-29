import { getContaId, unauthorized, supabaseAdmin } from '@/lib/mobileAuth';
import { getPortfolio } from '@/app/lib/portfolio-fornecedor';

// GET /api/cliente/fornecedores — confecções ATIVAS pra vitrine/destaque na Home.
// Só campos públicos (sem contato/WhatsApp); inclui capa = 1ª foto do portfólio.
export async function GET(req: Request) {
  const contaId = await getContaId(req);
  if (!contaId) return unauthorized();

  const { data: fs, error } = await supabaseAdmin
    .from('leads_fornecedores')
    .select('id, nome, cidade, estado, instagram, site, descricao_livre')
    .eq('status', 'ativo')
    .order('nome', { ascending: true })
    .limit(20);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const lista = await Promise.all(
    (fs ?? []).map(async (f) => {
      const portfolio = await getPortfolio(f.id);
      return {
        id: f.id,
        nome: f.nome,
        cidade: f.cidade ?? null,
        estado: f.estado ?? null,
        instagram: f.instagram ?? null,
        site: f.site ?? null,
        descricao: f.descricao_livre ?? null,
        capa: portfolio[0]?.url ?? null,
        portfolio_count: portfolio.length,
      };
    }),
  );

  return Response.json(lista);
}
