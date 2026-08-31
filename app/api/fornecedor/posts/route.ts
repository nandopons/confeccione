// Obsoleto: virou /api/fornecedor/produtos (catálogo estruturado). Stub 410.
export async function GET() {
  return Response.json({ error: 'Use /api/fornecedor/produtos' }, { status: 410 });
}
export async function POST() {
  return Response.json({ error: 'Use /api/fornecedor/produtos' }, { status: 410 });
}
