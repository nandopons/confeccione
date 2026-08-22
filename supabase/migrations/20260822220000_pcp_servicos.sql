-- PCP — serviços: design, modelagem e afins (22/08/2026)
--
-- O QUE FALTAVA
-- O roteiro cobre a costura. Mas existe trabalho que não é operação de peça:
-- criar arte, fazer modelagem, ajustar grade. O quadro já tinha uma etapa
-- "Design" — só não tinha como dizer que ela custa 4 horas.
--
-- AS TRÊS RESPOSTAS DO FERNANDO (22/08/2026) QUE DESENHARAM ISTO
--
-- 1. "Varia por pedido — só às vezes."
--    Modelagem não se repete em todo pedido do mesmo produto. Se morasse no
--    roteiro do produto, seria cobrada sempre — errado. Por isso o serviço é
--    pendurado no CARD (pcp_producao_servicos), não no produto.
--
-- 2. "São horas minhas/da equipe."
--    Design e modelagem disputam tempo real e podem virar gargalo. Então o
--    posto de trabalho é um RECURSO com capacidade, exatamente como uma
--    máquina — mesma conta de quantidade × horas/dia. Reaproveito
--    `pcp_maquinas` em vez de criar uma tabela paralela com a mesma
--    matemática: duas tabelas para o mesmo conceito divergiriam na primeira
--    mudança de regra. A coluna `tipo` só separa o que a tela mostra.
--
-- 3. "Sim, aparecem no orçamento."
--    O serviço carrega preço, além do tempo. Preço é opcional em cada uso:
--    às vezes você absorve.
--
-- APLICADA em produção em 22/08/2026 via MCP.

-- ---------------------------------------------------------------------------
-- Recurso deixa de ser só máquina.
-- ---------------------------------------------------------------------------
alter table public.pcp_maquinas
  add column if not exists tipo text not null default 'maquina'
    check (tipo in ('maquina', 'posto'));

comment on column public.pcp_maquinas.tipo is
  'maquina = equipamento de costura/corte; posto = trabalho humano com capacidade (design, modelagem). A conta de capacidade e gargalo é a mesma; o tipo só muda o que a tela pergunta (posto não tem troca de linha).';

-- ---------------------------------------------------------------------------
-- Catálogo de serviços. O padrão que você repete, para não redigitar.
-- ---------------------------------------------------------------------------
create table if not exists public.pcp_servicos (
  id            uuid primary key default gen_random_uuid(),
  codigo        text not null unique,
  nome          text not null,

  -- Onde o serviço consome capacidade. Null = não disputa hora com ninguém
  -- (terceirizado): entra como prazo e custo, fora do cálculo de gargalo.
  recurso_id    uuid references public.pcp_maquinas(id) on delete set null,

  horas_padrao  numeric(6,2) check (horas_padrao is null or horas_padrao > 0),
  preco_centavos integer check (preco_centavos is null or preco_centavos >= 0),
  descricao     text,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.pcp_servicos is
  'Serviços que não são operação de peça: design, modelagem, ajuste de grade. Catálogo com tempo e preço padrão — o uso real vai em pcp_producao_servicos e pode divergir do padrão.';
comment on column public.pcp_servicos.recurso_id is
  'Null = terceirizado, não consome capacidade interna. Preenchido = disputa horas daquele posto e pode virar gargalo.';

-- ---------------------------------------------------------------------------
-- O serviço acontecendo num pedido específico.
-- ---------------------------------------------------------------------------
create table if not exists public.pcp_producao_servicos (
  id          uuid primary key default gen_random_uuid(),
  card_id     uuid not null references public.producao_pedido(id) on delete cascade,
  servico_id  uuid not null references public.pcp_servicos(id) on delete restrict,

  -- Cópias do catálogo NO MOMENTO DO USO, editáveis. O padrão é sugestão: uma
  -- modelagem difícil leva o dobro, e mudar o catálogo depois não pode
  -- reescrever o que já foi planejado e cobrado.
  horas       numeric(6,2) not null check (horas > 0),
  preco_centavos integer check (preco_centavos is null or preco_centavos >= 0),

  descricao   text,
  criado_em   timestamptz not null default now()
);

comment on table public.pcp_producao_servicos is
  'Serviço executado num card. Horas e preço são cópias editáveis do catálogo: o padrão é sugestão, e alterar o catálogo depois não pode reescrever o que já foi planejado.';
comment on column public.pcp_producao_servicos.preco_centavos is
  'Null = não cobrado do cliente neste pedido (absorvido).';

create index if not exists pcp_producao_servicos_card_idx on public.pcp_producao_servicos (card_id);
create index if not exists pcp_producao_servicos_servico_idx on public.pcp_producao_servicos (servico_id);

alter table public.pcp_servicos           enable row level security;
alter table public.pcp_producao_servicos  enable row level security;
revoke all on public.pcp_servicos          from anon, authenticated;
revoke all on public.pcp_producao_servicos from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Semente: os dois postos e os serviços que o Fernando citou.
-- Horas e preços ficam VAZIOS — mesma regra do tempo de operação: número
-- inventado envenena o planejamento calado.
-- ---------------------------------------------------------------------------
insert into public.pcp_maquinas (codigo, nome, quantidade, horas_dia, setup_troca_min, tipo, ordem)
values
  ('design',    'Design',    1, 8, 0, 'posto', 10),
  ('modelagem', 'Modelagem', 1, 8, 0, 'posto', 11)
on conflict (codigo) do nothing;

insert into public.pcp_servicos (codigo, nome, recurso_id, descricao)
select v.codigo, v.nome, m.id, v.descricao
from (values
  ('arte',            'Criação de arte',        'design',    'Arte final, fechamento de arquivo, prova'),
  ('modelagem-nova',  'Modelagem nova',         'modelagem', 'Modelo novo, do zero'),
  ('ajuste-grade',    'Ajuste de grade',        'modelagem', 'Adaptação de tamanhos de um modelo existente')
) as v(codigo, nome, recurso, descricao)
left join public.pcp_maquinas m on m.codigo = v.recurso
on conflict (codigo) do nothing;
