import { supabaseAdmin } from '@/lib/mobileAuth';

// Estados do PEDIDO em que ele NÃO pode mais ser editado: já finalizado ou
// cancelado. Enquanto está em negociação (inclusive com orçamento 'definido'),
// os dois lados seguem editando até fechar — editar reabre o orçamento.
export const STATUS_BLOQUEADO = new Set(['completo', 'cancelado']);

type TamanhoQtd = { tamanho: string; qtd: number };
type Linha = {
  modelo: string;
  categoria: string | null;
  cor: string | null;
  material: string | null;
  total: number;
  tamanhos: TamanhoQtd[];
  publico: string | null;
  estampado: boolean;
  estampas: string[];
  acabamentos: string[];
  descricao: string | null;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim()) : []);

/** Sanitiza uma linha vinda do cliente; recomputa o total a partir dos tamanhos. */
function limparLinha(raw: unknown): Linha | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const modelo = str(o.modelo);
  if (!modelo) return null;
  const tamanhos: TamanhoQtd[] = Array.isArray(o.tamanhos)
    ? o.tamanhos
        .map((t) => {
          const to = (t ?? {}) as Record<string, unknown>;
          const tamanho = str(to.tamanho);
          const qtd = Math.max(0, Math.round(Number(to.qtd)) || 0);
          return tamanho && qtd > 0 ? { tamanho, qtd } : null;
        })
        .filter((x): x is TamanhoQtd => !!x)
    : [];
  if (tamanhos.length === 0) return null;
  return {
    modelo,
    categoria: str(o.categoria),
    cor: str(o.cor),
    material: str(o.material),
    total: tamanhos.reduce((s, t) => s + t.qtd, 0),
    tamanhos,
    publico: str(o.publico),
    estampado: !!o.estampado,
    estampas: strArr(o.estampas),
    acabamentos: strArr(o.acabamentos),
    descricao: str(o.descricao),
  };
}

/** Extrai um inteiro de prazo (aceita number ou string tipo "30 dias"). */
function parsePrazo(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.round(v)) || null;
  if (typeof v === 'string') {
    const m = v.match(/\d+/);
    if (m) return Math.max(0, parseInt(m[0], 10)) || null;
  }
  return null;
}

/**
 * Aplica a edição de linhas/prazo num pedido_assistente. O caller já validou
 * permissão e gating de status — aqui só sanitiza o corpo e grava. Se as linhas
 * mudaram e já havia orçamento 'definido', reabre o orçamento (mantém os valores
 * como rascunho) pra não ficar um orçamento inconsistente com o pedido novo.
 */
export async function aplicarEdicaoLinhas(req: Request, pedidoId: string, orcamentoStatusAtual?: string | null): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'Corpo inválido' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  if ('linhas' in body) {
    if (!Array.isArray(body.linhas)) return Response.json({ error: 'linhas deve ser uma lista' }, { status: 400 });
    const linhas = body.linhas.map(limparLinha).filter((x): x is Linha => !!x);
    if (linhas.length === 0) return Response.json({ error: 'Inclua ao menos um modelo com quantidade.' }, { status: 400 });
    patch.linhas = linhas;
    // Mexeu nos modelos depois de um orçamento fechado → reabre pra re-orçar.
    if (orcamentoStatusAtual === 'definido') {
      patch.orcamento_status = 'aguardando_fornecedor';
    }
  }

  if ('prazo_dias' in body) {
    patch.prazo_dias = parsePrazo(body.prazo_dias);
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: 'Nada pra atualizar' }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from('pedidos_assistente').update(patch).eq('id', pedidoId);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}
