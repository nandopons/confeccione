import { getFornecedorId, unauthorized } from '@/lib/mobileAuth';
import { removerPortfolio } from '@/app/lib/portfolio-fornecedor';

// DELETE /api/fornecedor/portfolio/[id] — remove uma foto do portfólio.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const fornecedorId = await getFornecedorId(req);
  if (!fornecedorId) return unauthorized();

  const { id } = await params;
  const ok = await removerPortfolio(fornecedorId, id);
  if (!ok) return Response.json({ error: 'foto não encontrada' }, { status: 404 });
  return Response.json({ ok: true });
}
