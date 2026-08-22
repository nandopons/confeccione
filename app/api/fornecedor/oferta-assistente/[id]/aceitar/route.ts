import { getFornecedorId, unauthorized, supabaseAdmin } from '@/lib/mobileAuth';
import { definirStatusOferta } from '@/app/lib/pedido-assistente-oferta';

// POST /api/fornecedor/oferta-assistente/[id]/aceitar
// Fornecedor aceita a oferta rica pelo app.
//
// ALINHADA COM O ACEITE DO SITE em 21/08/2026.
// Até aqui esta rota só mexia no banco: marcava a oferta como aceita, cancelava
// as demais, e pronto. Nenhum aviso saía — nem o contato do cliente pro
// fornecedor, nem o contato do fornecedor pro cliente, nem o e-mail, nem o
// resumo em PDF. Quem aceitasse pelo app ficava no escuro, e o cliente também.
// O comentário antigo dizia "NÃO libera contato do cliente (D5: contato só após
// pagar)" — essa política mudou em jul/2026 (decisão do Fernando: o fornecedor
// precisa alinhar detalhes ANTES de orçar). O site já seguia a regra nova; esta
// rota tinha ficado para trás.
//
// Agora o trabalho todo é de `definirStatusOferta`, o mesmo ponto que o site
// usa — cancelar as concorrentes, marcar `orcamento_status`, avisar os dois
// lados e mandar o PDF. Duplicar isso aqui garantiria que os dois caminhos
// voltassem a divergir na próxima mudança.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const fornecedorId = await getFornecedorId(req);
  if (!fornecedorId) return unauthorized();

  const { id } = await params;
  const { data: oferta, error } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('id, pedido_id, status')
    .eq('id', id)
    .eq('fornecedor_id', fornecedorId)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!oferta) return Response.json({ error: 'Oferta não encontrada' }, { status: 404 });
  if (oferta.status !== 'ofertada' && oferta.status !== 'aceita') {
    return Response.json({ error: 'Esta oferta não está mais disponível' }, { status: 409 });
  }

  // Claim: só quem realmente fizer a transição 'ofertada' → 'aceita' dispara os
  // avisos. Sem isso, um toque duplo no app (ou um retry de rede) mandaria a
  // mesma leva de WhatsApp e e-mail duas vezes pro cliente e pro fornecedor.
  const { data: claim } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .update({ status: 'aceita', respondido_em: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'ofertada')
    .select('id');

  const primeiraVez = (claim ?? []).length > 0;

  if (primeiraVez) {
    // Cancela as concorrentes, marca orcamento_status, avisa os dois lados e
    // manda o resumo em PDF. Falha aqui não pode derrubar o aceite — a oferta
    // já está aceita no banco, e o fornecedor não tem como saber disso.
    try {
      await definirStatusOferta(id, 'aceita');
    } catch (e) {
      console.error('[oferta-mobile] notificação de aceite falhou', id, e);
    }
  }

  // Pedido entra em alinhamento (chat aberto, antes do orçamento). Fica fora do
  // `primeiraVez` de propósito: é idempotente e barato, e conserta o pedido que
  // por algum motivo tenha ficado sem o status.
  await supabaseAdmin
    .from('pedidos_assistente')
    .update({ status: 'em_alinhamento' })
    .eq('id', oferta.pedido_id);

  return Response.json({ ok: true, pedido_id: oferta.pedido_id });
}
