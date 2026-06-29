import { getFornecedorId, unauthorized, supabaseAdmin } from '@/lib/mobileAuth';

// POST /api/fornecedor/pausar { pausar: boolean }
// Pausa (não recebe novas ofertas) ou retoma a conta do fornecedor logado.
export async function POST(req: Request) {
  const fornecedorId = await getFornecedorId(req);
  if (!fornecedorId) return unauthorized();

  let body: { pausar?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'payload inválido' }, { status: 400 });
  }

  const pausado_em = body.pausar ? new Date().toISOString() : null;
  const { error } = await supabaseAdmin
    .from('leads_fornecedores')
    .update({ pausado_em })
    .eq('id', fornecedorId);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, pausado_em });
}
