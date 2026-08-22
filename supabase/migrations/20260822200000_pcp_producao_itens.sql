-- PCP — o elo que faltava: card de produção → produto, cor e grade (22/08/2026)
--
-- O BURACO
-- O quadro de produção diz "10 camisas" em texto livre, herdado do pedido. O
-- cadastro técnico sabe que a camisa básica tem 15 operações e quanto cada uma
-- custa. As duas coisas nunca se falavam — então o roteiro, por mais completo
-- que estivesse, não virava hora de máquina nenhuma. Esta tabela é a ponte.
--
-- POR QUE UMA LINHA POR TAMANHO, E NÃO UMA GRADE EM JSONB
-- Guardar {"P":5,"M":10} num jsonb obrigaria a manter uma coluna `quantidade`
-- ao lado, somada na aplicação — e no dia em que as duas divergissem, o
-- planejamento inteiro sairia errado sem nenhum sinal. Uma linha por
-- (card, produto, cor, tamanho) torna a divergência impossível: o total é
-- sempre uma soma, nunca um número guardado.
--
-- POR QUE A COR ESTÁ AQUI
-- Cor não é enfeite de cadastro: é ela que dispara a troca de linha da máquina
-- (o `setup_troca_min` de pcp_maquinas). 10 pretas + 10 brancas custa mais que
-- 20 pretas, e sem a cor no item não há como o sistema saber disso.
--
-- produto_id É OBRIGATÓRIO
-- Decisão do Fernando (22/08/2026): ele cadastra o produto ANTES de formalizar
-- o orçamento. Então não existe item de produção sem ficha técnica — e assim
-- nenhum item entra no quadro sem saber quanto custa.
--
-- APLICADA em produção em 22/08/2026 via MCP.

create table if not exists public.pcp_producao_itens (
  id          uuid primary key default gen_random_uuid(),
  card_id     uuid not null references public.producao_pedido(id) on delete cascade,
  produto_id  uuid not null references public.pcp_produtos(id) on delete restrict,

  -- Vazio vira 'Único': o cálculo de setup conta CORES distintas, e null
  -- espalhado criaria grupos fantasma que nunca casam entre si.
  cor         text not null default 'Único',
  tamanho     text not null,
  quantidade  integer not null check (quantidade > 0),

  observacao  text,
  criado_em   timestamptz not null default now(),
  constraint pcp_producao_itens_uk unique (card_id, produto_id, cor, tamanho)
);

comment on table public.pcp_producao_itens is
  'O que cada card do quadro de produção realmente é: produto da ficha técnica, cor e grade. Uma linha por tamanho — o total é sempre uma soma, nunca um número guardado que pode divergir.';
comment on column public.pcp_producao_itens.cor is
  'Dispara a troca de linha (pcp_maquinas.setup_troca_min). Cores distintas no mesmo card custam setups distintos.';
comment on column public.pcp_producao_itens.produto_id is
  'on delete RESTRICT: apagar um produto usado em produção apagaria a régua de um trabalho já planejado. Produto sai de circulação por ativo = false.';

create index if not exists pcp_producao_itens_card_idx on public.pcp_producao_itens (card_id);
create index if not exists pcp_producao_itens_produto_idx on public.pcp_producao_itens (produto_id);

alter table public.pcp_producao_itens enable row level security;
revoke all on public.pcp_producao_itens from anon, authenticated;
