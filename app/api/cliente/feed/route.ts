import { getContaId, unauthorized } from '@/lib/mobileAuth';
import { getFeedProdutos } from '@/app/lib/produtos';

// GET /api/cliente/feed — catálogo de produtos (confecções e atacadistas), recentes primeiro.
export async function GET(req: Request) {
  const contaId = await getContaId(req);
  if (!contaId) return unauthorized();
  return Response.json(await getFeedProdutos(40));
}
