-- Orçamento avulso do admin entra no quadro de produção (21/08/2026)
--
-- O BURACO QUE ISTO FECHA
-- O gerador de orçamento avulso (/admin/orcamentos) já criava cobrança no
-- Asaas desde 02/07/2026 — mas o webhook (app/api/asaas/webhook/route.ts) só
-- procurava o asaas_payment_id em pedidos_assistente. A tabela `orcamentos`
-- nem tinha coluna de pagamento. Resultado: cliente pagava um orçamento do
-- admin e o sistema NUNCA ficava sabendo. Em 21/08/2026 eram 17 cobranças
-- geradas, R$ 17.641,36, sem nenhum registro de pagamento.
--
-- POR QUE O QUADRO PASSA A TER DUAS ORIGENS
-- As duas coisas viram produção e são pedidos de verdade, mas têm formatos
-- diferentes: `pedidos_assistente.linhas` é modelo/cor/tamanho/estampa, e
-- `orcamentos.itens` é descrição livre + quantidade. Fabricar um
-- pedidos_assistente falso a partir de um orçamento poluiria o funil, as
-- métricas e o painel do fornecedor com pedidos que nunca passaram por
-- oferta. Então o card ganha origem, e cada card aponta para exatamente uma
-- das duas tabelas.
--
-- Reestruturar agora é barato: as tabelas de produção nasceram ontem e têm 4
-- linhas. Daqui a três meses seria caro.
--
-- APLICADA em produção em 21/08/2026 via MCP.

-- ---------------------------------------------------------------------------
-- 1. Pagamento do orçamento avulso
-- ---------------------------------------------------------------------------
alter table public.orcamentos
  add column if not exists pagamento_status text,
  add column if not exists pago_em timestamptz;

comment on column public.orcamentos.pagamento_status is
  'null = sem cobrança ou não conferido; ''gerado'' = cobrança criada; ''pago'' = confirmado pelo Asaas (webhook ou reconciliação).';

create index if not exists orcamentos_asaas_payment_idx on public.orcamentos (asaas_payment_id);

-- Orçamento que já tem cobrança, mas ainda não foi conferido, começa em
-- 'gerado' — é o estado real dele.
update public.orcamentos
   set pagamento_status = 'gerado'
 where asaas_payment_id is not null and pagamento_status is null;

-- ---------------------------------------------------------------------------
-- 2. Card de produção passa a aceitar as duas origens
-- ---------------------------------------------------------------------------
alter table public.producao_pedido
  add column if not exists id uuid not null default gen_random_uuid(),
  add column if not exists orcamento_id uuid references public.orcamentos(id) on delete cascade;

alter table public.producao_pedido drop constraint if exists producao_pedido_pkey;
alter table public.producao_pedido alter column pedido_id drop not null;
alter table public.producao_pedido add primary key (id);

-- Exatamente uma origem por card. Sem isto, um card órfão (as duas nulas) ou
-- ambíguo (as duas preenchidas) passaria — e o quadro não saberia o que mostrar.
alter table public.producao_pedido
  add constraint producao_pedido_uma_origem_check
  check (num_nonnulls(pedido_id, orcamento_id) = 1);

alter table public.producao_pedido add constraint producao_pedido_pedido_uk unique (pedido_id);
alter table public.producao_pedido add constraint producao_pedido_orcamento_uk unique (orcamento_id);

-- ---------------------------------------------------------------------------
-- 3. Eventos idem
-- ---------------------------------------------------------------------------
alter table public.producao_eventos
  add column if not exists orcamento_id uuid references public.orcamentos(id) on delete cascade;

alter table public.producao_eventos alter column pedido_id drop not null;

alter table public.producao_eventos
  add constraint producao_eventos_uma_origem_check
  check (num_nonnulls(pedido_id, orcamento_id) = 1);

create index if not exists producao_eventos_orcamento_idx
  on public.producao_eventos (orcamento_id, criado_em desc);
