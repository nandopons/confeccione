import { getFornecedorId, unauthorized } from '@/lib/mobileAuth';
import { getMeusProdutos, criarProduto, MAX_PRODUTO_BYTES } from '@/app/lib/produtos';

// GET /api/fornecedor/produtos — catálogo do fornecedor logado.
export async function GET(req: Request) {
  const fornecedorId = await getFornecedorId(req);
  if (!fornecedorId) return unauthorized();
  return Response.json(await getMeusProdutos(fornecedorId));
}

// POST /api/fornecedor/produtos — cadastra um produto (multipart: file + campos).
export async function POST(req: Request) {
  const fornecedorId = await getFornecedorId(req);
  if (!fornecedorId) return unauthorized();

  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return Response.json({ error: 'envie multipart com o campo file' }, { status: 400 });
  }

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return Response.json({ error: 'imagem ausente' }, { status: 400 });
  if (!file.type.startsWith('image/')) return Response.json({ error: 'envie uma imagem' }, { status: 400 });
  if (file.size > MAX_PRODUTO_BYTES) return Response.json({ error: 'imagem muito grande (máx 10MB)' }, { status: 400 });

  const str = (k: string) => (typeof form.get(k) === 'string' ? (form.get(k) as string) : null);
  const num = (k: string) => {
    const v = form.get(k);
    const n = Number(v);
    return typeof v === 'string' && v.trim() && Number.isFinite(n) ? n : null;
  };

  const nome = (str('nome') ?? '').trim();
  if (!nome) return Response.json({ error: 'informe o nome do produto' }, { status: 400 });

  try {
    const produto = await criarProduto(fornecedorId, file, {
      nome,
      categoria: str('categoria'),
      preco_centavos: num('preco_centavos'),
      qtd_minima: num('qtd_minima'),
      descricao: str('descricao'),
    });
    return Response.json(produto, { status: 201 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'falha ao cadastrar produto' }, { status: 500 });
  }
}
