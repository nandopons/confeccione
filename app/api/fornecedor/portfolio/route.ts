import { getFornecedorId, unauthorized } from '@/lib/mobileAuth';
import { getPortfolio, uploadPortfolio, MAX_PORTFOLIO_BYTES } from '@/app/lib/portfolio-fornecedor';

// GET  /api/fornecedor/portfolio — lista as fotos do fornecedor logado.
export async function GET(req: Request) {
  const fornecedorId = await getFornecedorId(req);
  if (!fornecedorId) return unauthorized();
  return Response.json(await getPortfolio(fornecedorId));
}

// POST /api/fornecedor/portfolio — sobe uma foto (multipart { file }).
export async function POST(req: Request) {
  const fornecedorId = await getFornecedorId(req);
  if (!fornecedorId) return unauthorized();

  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return Response.json({ error: 'envie multipart com o campo file' }, { status: 400 });
  }

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return Response.json({ error: 'arquivo ausente' }, { status: 400 });
  if (!file.type.startsWith('image/')) return Response.json({ error: 'envie uma imagem' }, { status: 400 });
  if (file.size > MAX_PORTFOLIO_BYTES) return Response.json({ error: 'imagem muito grande (máx 10MB)' }, { status: 400 });

  try {
    const item = await uploadPortfolio(fornecedorId, file);
    return Response.json(item, { status: 201 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'falha no upload' }, { status: 500 });
  }
}
