import { getFornecedorId, unauthorized, supabaseAdmin } from '@/lib/mobileAuth';
import { precoClienteDeLiquido } from '@/app/lib/pedido-assistente-oferta';
import { atualizarValorCobrancaPix } from '@/app/lib/pedido-pagamento';

// POST /api/fornecedor/pedido-assistente/[id]/orcar
// Fornecedor (que aceitou) envia/atualiza o orçamento do pedido RICO.
// Modelo (igual ao site): o fornecedor informa o LÍQUIDO dele — unitário por
// modelo + extras (arte/embalagem/etc) + frete — e o sistema soma o Seguro
// Confeccione (3%) embutido pra chegar no preço do cliente (valor_centavos, que
// é o que a cobrança ASAAS usa). Reenviável enquanto não pago.

type Linha = { total?: number | null; tamanhos?: { qtd?: number | null }[] | null; [k: string]: unknown };
type ExtraIn = { descricao?: unknown; valor_centavos?: unknown };

function qtdDaLinha(l: Linha): number {
  if (typeof l.total === 'number' && l.total > 0) return l.total;
  return (l.tamanhos ?? []).reduce((a, t) => a + (Number(t?.qtd) || 0), 0);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const fornecedorId = await getFornecedorId(req);
  if (!fornecedorId) return unauthorized();

  const { id } = await params; // pedido_id
  const { data: oferta } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('id, status')
    .eq('pedido_id', id)
    .eq('fornecedor_id', fornecedorId)
    .eq('status', 'aceita')
    .maybeSingle();
  if (!oferta) return Response.json({ error: 'Você não está nesta negociação' }, { status: 409 });

  let body: {
    producao?: unknown; // number[] — unitário LÍQUIDO por linha (alinhado a linhas)
    extras?: unknown; // { descricao, valor_centavos }[] — LÍQUIDO
    frete_centavos?: unknown; // LÍQUIDO
    prazo_dias?: unknown;
    observacao?: unknown;
    repasse_centavos?: unknown; // legado (app antigo): produção total única, LÍQUIDO
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'payload inválido' }, { status: 400 });
  }

  const { data: pedido } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, linhas, pagamento_status, asaas_payment_id, valor_centavos')
    .eq('id', id)
    .maybeSingle<{
      id: string;
      linhas: Linha[] | null;
      pagamento_status: string | null;
      asaas_payment_id: string | null;
      valor_centavos: number | null;
    }>();
  if (!pedido) return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });
  if (pedido.pagamento_status === 'pago') {
    return Response.json({ error: 'Pedido já pago — o orçamento não pode mais mudar.' }, { status: 409 });
  }

  const linhas: Linha[] = Array.isArray(pedido.linhas) ? pedido.linhas : [];

  // Frete (líquido)
  const freteLiquido = Number.isFinite(Number(body.frete_centavos)) ? Math.max(0, Math.round(Number(body.frete_centavos))) : 0;

  // Extras (líquido) — arte/design, embalagem, taxas… cada um {descricao, valor}
  const extras = (Array.isArray(body.extras) ? (body.extras as ExtraIn[]) : [])
    .map((e) => ({ descricao: typeof e?.descricao === 'string' ? e.descricao.trim() : '', valor_centavos: Math.round(Number(e?.valor_centavos)) || 0 }))
    .filter((e) => e.descricao && e.valor_centavos > 0);
  const extrasLiquido = extras.reduce((s, e) => s + e.valor_centavos, 0);

  // Produção por modelo (unitário líquido alinhado às linhas) — ou legado (total único).
  let produtosLiquido = 0;
  let linhasNovas: Linha[] = linhas;
  let producaoBreakdown: { modelo: string | null; qtd: number; unit_centavos: number; subtotal_centavos: number }[] = [];

  if (Array.isArray(body.producao)) {
    const unit = (body.producao as unknown[]).map((v) => Math.round(Number(v)));
    if (unit.length !== linhas.length || unit.some((v) => !Number.isInteger(v) || v <= 0)) {
      return Response.json({ error: 'Informe um valor unitário válido pra cada modelo.' }, { status: 400 });
    }
    linhasNovas = linhas.map((l, i) => ({ ...l, preco_unit_centavos: unit[i] }));
    producaoBreakdown = linhas.map((l, i) => {
      const q = qtdDaLinha(l);
      produtosLiquido += q * unit[i];
      return { modelo: (l.modelo as string) ?? null, qtd: q, unit_centavos: unit[i], subtotal_centavos: q * unit[i] };
    });
  } else if (Number.isFinite(Number(body.repasse_centavos))) {
    // Compat com app antigo: um valor único de produção (líquido), sem breakdown.
    produtosLiquido = Math.max(0, Math.round(Number(body.repasse_centavos)));
  } else {
    return Response.json({ error: 'Informe o valor do orçamento.' }, { status: 400 });
  }

  const totalLiquido = produtosLiquido + extrasLiquido + freteLiquido;
  if (totalLiquido <= 0) return Response.json({ error: 'Orçamento zerado.' }, { status: 400 });

  // Preço do cliente = líquido + Seguro Confeccione (3%) embutido.
  const valorCliente = precoClienteDeLiquido(totalLiquido);
  const freteCliente = freteLiquido > 0 ? precoClienteDeLiquido(freteLiquido) : 0;
  const seguroCentavos = valorCliente - totalLiquido; // 3% que o cliente paga; soma exata

  const temBreakdown = producaoBreakdown.length > 0 || extras.length > 0;
  const orcamentoItens = temBreakdown
    ? { producao: producaoBreakdown, extras, frete_centavos: freteLiquido, seguro_centavos: seguroCentavos, total_centavos: valorCliente }
    : null;

  const prazoDias = Number.isFinite(Number(body.prazo_dias)) ? Math.round(Number(body.prazo_dias)) : null;
  const observacao = typeof body.observacao === 'string' ? body.observacao.trim() || null : null;
  const agora = new Date().toISOString();

  const patch: Record<string, unknown> = {
    linhas: linhasNovas,
    valor_centavos: valorCliente, // o que o ASAAS cobra (cliente)
    frete_centavos: freteCliente,
    repasse_centavos: totalLiquido, // líquido do fornecedor
    orcamento_itens: orcamentoItens,
    orcamento_status: 'definido',
    orcamento_definido_em: agora,
    status: 'orcado',
    atualizado_em: agora,
  };
  if (prazoDias != null) patch.prazo_dias = prazoDias;

  const { error: pErr } = await supabaseAdmin.from('pedidos_assistente').update(patch).eq('id', id);
  if (pErr) return Response.json({ error: pErr.message }, { status: 500 });

  await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .update({ valor_repasse_centavos: totalLiquido, observacao })
    .eq('id', oferta.id);

  // Cobrança já gerada (não paga) com valor antigo → atualiza no ASAAS.
  if (pedido.asaas_payment_id && pedido.valor_centavos !== valorCliente) {
    try {
      const upd = await atualizarValorCobrancaPix(pedido.asaas_payment_id, valorCliente);
      await supabaseAdmin
        .from('pedidos_assistente')
        .update({ pix_copia_cola: upd.copiaCola, pix_qr_imagem: upd.qrImagem, pix_link: upd.invoiceUrl })
        .eq('id', id);
    } catch (e) {
      console.error('[orcar] atualização da cobrança ASAAS falhou', e);
    }
  }

  return Response.json({ ok: true });
}
