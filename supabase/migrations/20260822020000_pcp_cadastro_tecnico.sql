-- PCP — cadastro técnico: máquinas, produtos, roteiro de operações (22/08/2026)
--
-- O QUE ISTO RESOLVE
-- O quadro de produção sabe QUE um pedido existe e em que etapa está. Não sabe
-- QUANTO trabalho ele é. "10 camisas básicas" não diz nada sobre horas de
-- overloque, e sem isso não há como dizer quanto de mão de obra a semana pede
-- nem qual máquina estoura primeiro. Este cadastro é a régua que falta.
--
-- PREFIXO pcp_ DE PROPÓSITO
-- Já existe `produtos` (catálogo comercial do fornecedor, hoje vazio) e
-- `precos_produtos` (tabela de preços). Ficha técnica é outra coisa: mesmo
-- nome, domínio diferente. Misturar as duas custaria caro no dia em que o
-- catálogo comercial começar a ser usado.
--
-- TEMPO É POR OPERAÇÃO, NÃO POR TAMANHO
-- As medidas que variam por tamanho (ribana 5,3 × 40 no M, 5,3 × 41 no G)
-- mudam consumo de tecido e instrução de corte — não o tempo de costura.
-- Por isso elas vivem em `pcp_componentes` e não em `pcp_operacoes`.
--
-- TEMPOS NASCEM VAZIOS
-- Nenhuma operação é semeada com tempo. Número de tempo-padrão inventado
-- envenena todo cálculo de capacidade que vier depois, e envenena calado —
-- o gráfico fica bonito e errado. Vazio aparece como pendência na tela.

-- ---------------------------------------------------------------------------
-- Parque de máquinas. Uma linha por TIPO, com quantas existem.
-- ---------------------------------------------------------------------------
create table if not exists public.pcp_maquinas (
  id          uuid primary key default gen_random_uuid(),
  codigo      text not null unique,
  nome        text not null,
  quantidade  integer not null default 1 check (quantidade >= 0),
  horas_dia   numeric(4,2) not null default 8 check (horas_dia >= 0 and horas_dia <= 24),

  -- Tempo de troca de linha/cor NESTA máquina. Overloque com 4 cones demora
  -- mais que uma reta com 1. É o que faz agrupar cores valer a pena — e o que
  -- explica por que 10 pretas + 10 brancas não custa o mesmo que 20 pretas.
  setup_troca_min numeric(5,2) not null default 0 check (setup_troca_min >= 0),

  observacao  text,
  ordem       integer not null default 0,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.pcp_maquinas is
  'Tipos de máquina do parque, com quantas existem e quantas horas cada uma roda por dia. Capacidade diária de um tipo = quantidade × horas_dia.';
comment on column public.pcp_maquinas.setup_troca_min is
  'Minutos para trocar linha/cor nesta máquina. Contado uma vez por máquina por cor do lote.';

-- ---------------------------------------------------------------------------
-- Produtos (ficha técnica). "Camisa básica", não "camiseta preta M".
-- ---------------------------------------------------------------------------
create table if not exists public.pcp_produtos (
  id          uuid primary key default gen_random_uuid(),
  codigo      text not null unique,
  nome        text not null,
  descricao   text,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.pcp_produtos is
  'Modelo de peça com roteiro de produção próprio. Cor e tamanho NÃO são produtos diferentes — são variações do mesmo roteiro.';

-- ---------------------------------------------------------------------------
-- Roteiro: as operações, na ordem em que acontecem.
--
-- A ORDEM NÃO É ENFEITE: é ela que faz o gargalo existir. Se a galoneira só
-- entra depois do overloque, a fila na galoneira depende de quando o overloque
-- libera — capacidade média por máquina esconde isso.
-- ---------------------------------------------------------------------------
create table if not exists public.pcp_operacoes (
  id          uuid primary key default gen_random_uuid(),
  produto_id  uuid not null references public.pcp_produtos(id) on delete cascade,
  ordem       integer not null check (ordem > 0),
  descricao   text not null,

  -- null = operação sem máquina (corte manual, conferência, dobra).
  maquina_id  uuid references public.pcp_maquinas(id) on delete set null,

  -- Segundos por PEÇA. Null = ainda não cronometrado; a tela cobra.
  tempo_segundos integer check (tempo_segundos is null or tempo_segundos > 0),

  observacao  text,
  criado_em   timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint pcp_operacoes_produto_ordem_uk unique (produto_id, ordem) deferrable initially deferred
);

comment on column public.pcp_operacoes.tempo_segundos is
  'Segundos por peça. Null = não cronometrado — o produto não entra em cálculo de capacidade enquanto faltar.';
comment on constraint pcp_operacoes_produto_ordem_uk on public.pcp_operacoes is
  'Deferrable porque reordenar o roteiro passa por estados intermediários com ordem repetida dentro da mesma transação.';

create index if not exists pcp_operacoes_produto_idx on public.pcp_operacoes (produto_id, ordem);
create index if not exists pcp_operacoes_maquina_idx on public.pcp_operacoes (maquina_id);

-- ---------------------------------------------------------------------------
-- Componentes cortados e suas medidas.
--
-- Modelado exatamente como o Fernando descreveu: a LARGURA é do modelo (ribana
-- da básica sai sempre com 5,3 cm), o COMPRIMENTO é do tamanho (M = 40, G = 41).
-- Guardar largura repetida em cada tamanho convidaria os valores a divergirem.
-- ---------------------------------------------------------------------------
create table if not exists public.pcp_componentes (
  id          uuid primary key default gen_random_uuid(),
  produto_id  uuid not null references public.pcp_produtos(id) on delete cascade,
  nome        text not null,
  largura_cm  numeric(6,2) check (largura_cm is null or largura_cm > 0),
  observacao  text,
  ordem       integer not null default 0,
  criado_em   timestamptz not null default now(),
  constraint pcp_componentes_produto_nome_uk unique (produto_id, nome)
);

comment on table public.pcp_componentes is
  'Peças cortadas do produto (ribana da gola, viés de ombro a ombro). Largura é do modelo; comprimento varia por tamanho, em pcp_componente_medidas.';

create table if not exists public.pcp_componente_medidas (
  id            uuid primary key default gen_random_uuid(),
  componente_id uuid not null references public.pcp_componentes(id) on delete cascade,
  tamanho       text not null,
  comprimento_cm numeric(6,2) check (comprimento_cm is null or comprimento_cm > 0),
  constraint pcp_componente_medidas_uk unique (componente_id, tamanho)
);

create index if not exists pcp_componente_medidas_comp_idx on public.pcp_componente_medidas (componente_id);

-- ---------------------------------------------------------------------------
-- Interno: service_role só. Este cadastro é o custo da operação — nem cliente
-- nem fornecedor têm o que fazer com ele hoje.
-- ---------------------------------------------------------------------------
alter table public.pcp_maquinas            enable row level security;
alter table public.pcp_produtos            enable row level security;
alter table public.pcp_operacoes           enable row level security;
alter table public.pcp_componentes         enable row level security;
alter table public.pcp_componente_medidas  enable row level security;

revoke all on public.pcp_maquinas           from anon, authenticated;
revoke all on public.pcp_produtos           from anon, authenticated;
revoke all on public.pcp_operacoes          from anon, authenticated;
revoke all on public.pcp_componentes        from anon, authenticated;
revoke all on public.pcp_componente_medidas from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Semente: o parque e a camisa básica, ditados pelo Fernando em 22/08/2026.
-- Tempos ficam NULL — ele cronometra.
-- ---------------------------------------------------------------------------
insert into public.pcp_maquinas (codigo, nome, quantidade, horas_dia, setup_troca_min, ordem)
values
  ('overloque',     'Overloque',      1, 8, 0, 1),
  ('galoneira',     'Galoneira',      1, 8, 0, 2),
  ('ombro_a_ombro', 'Ombro a ombro',  1, 8, 0, 3),
  ('corte',         'Corte',          1, 8, 0, 4)
on conflict (codigo) do nothing;

insert into public.pcp_produtos (codigo, nome, descricao)
values ('camisa-basica', 'Camisa básica', 'Malha, gola de ribana, manga curta.')
on conflict (codigo) do nothing;

insert into public.pcp_operacoes (produto_id, ordem, descricao, maquina_id, observacao)
select p.id, v.ordem, v.descricao, m.id, v.obs
from public.pcp_produtos p
cross join (values
  (1,  'Unir ombro esquerdo e direito',              'overloque',     null),
  (2,  'Cortar gola de ribana',                      'corte',         'Largura e comprimento na ficha técnica do componente'),
  (3,  'Rebater gola',                               'galoneira',     '2 agulhas separadas, com guia'),
  (4,  'Cortar viés de ombro a ombro',               'corte',         '2,5 cm de largura'),
  (5,  'Passar o viés de ombro a ombro',             'ombro_a_ombro', null),
  (6,  'Pregar mangas',                              'overloque',     null),
  (7,  'Fechamento lateral',                         'overloque',     null),
  (8,  'Barra da manga esquerda',                    'galoneira',     null),
  (9,  'Barra da manga direita',                     'galoneira',     null),
  (10, 'Barra da cintura',                           'galoneira',     null)
) as v(ordem, descricao, maquina, obs)
left join public.pcp_maquinas m on m.codigo = v.maquina
where p.codigo = 'camisa-basica'
  and not exists (select 1 from public.pcp_operacoes o where o.produto_id = p.id);

insert into public.pcp_componentes (produto_id, nome, largura_cm, ordem)
select p.id, v.nome, v.largura, v.ordem
from public.pcp_produtos p
cross join (values
  ('Ribana da gola',        5.3, 1),
  ('Viés de ombro a ombro', 2.5, 2)
) as v(nome, largura, ordem)
where p.codigo = 'camisa-basica'
on conflict (produto_id, nome) do nothing;

-- Só M e G: são os únicos comprimentos que o Fernando informou. P e GG ficam
-- de fora em vez de sair de uma interpolação inventada.
insert into public.pcp_componente_medidas (componente_id, tamanho, comprimento_cm)
select c.id, v.tamanho, v.comprimento
from public.pcp_componentes c
join public.pcp_produtos p on p.id = c.produto_id
cross join (values ('M', 40.0), ('G', 41.0)) as v(tamanho, comprimento)
where p.codigo = 'camisa-basica' and c.nome = 'Ribana da gola'
on conflict (componente_id, tamanho) do nothing;
