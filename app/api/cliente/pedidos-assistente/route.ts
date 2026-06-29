import { getContaId, unauthorized, supabaseAdmin } from '@/lib/mobileAuth';

// POST /api/cliente/pedidos-assistente — cria um pedido RICO (por modelo) a
// partir do app. Sem disparo de oferta: entra em "buscando_fornecedor" e o
// match/chat/orçamento seguem o novo fluxo. Endereço/contato vêm da conta.
export async function POST(req: Request) {
  const contaId = await getContaId(req);
  if (!contaId) return unauthorized();

  let body: { linhas?: unknown; prazo?: string | number | null };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'payload inválido' }, { status: 400 });
  }

  const linhas = Array.isArray(body.linhas) ? body.linhas : [];
  if (linhas.length === 0) {
    return Response.json({ error: 'Adicione ao menos um modelo' }, { status: 400 });
  }

  const { data: conta } = await supabaseAdmin
    .from('contas_clientes')
    .select('nome, email, whatsapp, cep, logradouro, numero, complemento, bairro, cidade, uf')
    .eq('id', contaId)
    .maybeSingle();

  const prazoDias =
    body.prazo != null ? parseInt(String(body.prazo).replace(/\D/g, ''), 10) || null : null;
  const categoria = (linhas[0] as { categoria?: string | null })?.categoria ?? null;

  const { data, error } = await supabaseAdmin
    .from('pedidos_assistente')
    .insert({
      conta_id: contaId,
      linhas,
      prazo_dias: prazoDias,
      categoria,
      status: 'buscando_fornecedor',
      origem: 'app',
      nome: conta?.nome ?? null,
      telefone: conta?.whatsapp ?? null,
      email: conta?.email ?? null,
      cep: conta?.cep ?? null,
      logradouro: conta?.logradouro ?? null,
      numero: conta?.numero ?? null,
      complemento: conta?.complemento ?? null,
      bairro: conta?.bairro ?? null,
      cidade: conta?.cidade ?? null,
      uf: conta?.uf ?? null,
    })
    .select('id')
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ id: data.id }, { status: 201 });
}
