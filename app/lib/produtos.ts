import { randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/mobileAuth';

export const BUCKET_PRODUTOS = 'produtos';
export const MAX_PRODUTO_BYTES = 10 * 1024 * 1024; // 10 MiB

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60);
}

// Produto do catálogo do fornecedor (vira o feed do cliente). Dados estruturados.
export type ProdutoFeed = {
  id: string;
  fornecedor_id: string;
  autor: string;
  tipo: 'confeccao' | 'atacado';
  local: string | null;
  imagem: string;
  nome: string;
  categoria: string | null;
  preco_centavos: number | null;
  qtd_minima: number | null;
  descricao: string | null;
  criado_em: string;
};

export type ProdutoInput = {
  nome: string;
  categoria?: string | null;
  preco_centavos?: number | null;
  qtd_minima?: number | null;
  descricao?: string | null;
};

type Row = {
  id: string;
  fornecedor_id: string;
  path: string;
  nome: string;
  categoria: string | null;
  preco_centavos: number | null;
  qtd_minima: number | null;
  descricao: string | null;
  criado_em: string;
  leads_fornecedores?: { nome: string | null; cidade: string | null; estado: string | null; tipo_perfil: string | null } | null;
};

const SELECT =
  'id, fornecedor_id, path, nome, categoria, preco_centavos, qtd_minima, descricao, criado_em, leads_fornecedores(nome, cidade, estado, tipo_perfil)';

const urlPublica = (path: string) => supabaseAdmin.storage.from(BUCKET_PRODUTOS).getPublicUrl(path).data.publicUrl;

function mapProduto(r: Row): ProdutoFeed {
  const f = r.leads_fornecedores ?? null;
  const local = f ? [f.cidade, f.estado].filter(Boolean).join('/') : '';
  return {
    id: r.id,
    fornecedor_id: r.fornecedor_id,
    autor: f?.nome ?? 'Confecção',
    tipo: f?.tipo_perfil === 'atacado' ? 'atacado' : 'confeccao',
    local: local || null,
    imagem: urlPublica(r.path),
    nome: r.nome,
    categoria: r.categoria,
    preco_centavos: r.preco_centavos,
    qtd_minima: r.qtd_minima,
    descricao: r.descricao,
    criado_em: r.criado_em,
  };
}

export async function getFeedProdutos(limit = 40): Promise<ProdutoFeed[]> {
  const { data } = await supabaseAdmin
    .from('produtos')
    .select(SELECT)
    .eq('ativo', true)
    .order('criado_em', { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => mapProduto(r as unknown as Row));
}

export async function getMeusProdutos(fornecedorId: string): Promise<ProdutoFeed[]> {
  const { data } = await supabaseAdmin
    .from('produtos')
    .select(SELECT)
    .eq('fornecedor_id', fornecedorId)
    .order('criado_em', { ascending: false });
  return (data ?? []).map((r) => mapProduto(r as unknown as Row));
}

export async function criarProduto(fornecedorId: string, file: File, dados: ProdutoInput): Promise<ProdutoFeed> {
  const nome = (dados.nome ?? '').trim();
  if (!nome) throw new Error('informe o nome do produto');

  const path = `${fornecedorId}/${randomUUID()}_${sanitizeFilename(file.name || 'produto.jpg')}`;
  const mime = file.type && file.type.length > 0 ? file.type : 'image/jpeg';
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await supabaseAdmin.storage.from(BUCKET_PRODUTOS).upload(path, buffer, { contentType: mime, upsert: false });
  if (upErr) throw upErr;

  const { data, error } = await supabaseAdmin
    .from('produtos')
    .insert({
      fornecedor_id: fornecedorId,
      path,
      nome,
      categoria: dados.categoria?.trim() || null,
      preco_centavos: Number.isFinite(Number(dados.preco_centavos)) ? Math.round(Number(dados.preco_centavos)) : null,
      qtd_minima: Number.isFinite(Number(dados.qtd_minima)) ? Math.round(Number(dados.qtd_minima)) : null,
      descricao: dados.descricao?.trim() || null,
    })
    .select(SELECT)
    .single();

  if (error || !data) {
    await supabaseAdmin.storage.from(BUCKET_PRODUTOS).remove([path]).catch(() => {});
    throw error ?? new Error('falha ao salvar o produto');
  }
  return mapProduto(data as unknown as Row);
}
