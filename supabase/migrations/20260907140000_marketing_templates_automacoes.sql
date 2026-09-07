-- ============================================================================
-- MARKETING — biblioteca de templates + motor de automação (já aplicada em prod)
--
-- templates_marketing: o conteúdo reutilizável, separado de quem recebe.
--   email       → assunto + corpo (Resend)
--   whatsapp    → template aprovado na Meta (ou texto puro via Z-API)
--   mala_direta → peça física (panfleto/catálogo/carta): arte, formato, peso e
--                 custo. Sem envio automático — por ora é cadastro + lista de
--                 endereços exportada da base.
--
-- automacoes_marketing: o fluxo. Um gatilho (o que faz o lead entrar), um
-- público (filtro da base) e uma sequência de passos, cada um com espera em
-- dias e um template. automacao_execucoes guarda onde cada lead está.
--
-- A antiga "nutrição automática" (marketing_config + /api/cron/nutricao) foi
-- aposentada: virou o fluxo seed "Retomada de pedido parado", que nasce
-- PAUSADO — o toggle antigo já estava desligado em prod, então nada muda de
-- comportamento até alguém ativar na tela.
--
-- Padrão do projeto: RLS habilitado + default-deny (acesso só via service_role).
-- ============================================================================

create table if not exists public.templates_marketing (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  canal         text not null,                     -- email | whatsapp | mala_direta
  descricao     text,
  assunto       text,
  corpo         text not null default '',
  template_meta text,
  template_params jsonb not null default '{"corpo": []}',
  usa_template_oficial boolean not null default true,
  formato       text,                              -- panfleto | catalogo | carta | cartao_postal | brinde
  arte_url      text,
  peso_gramas   integer,
  dimensoes     text,
  custo_unitario_centavos integer,
  tags          text[] not null default '{}',
  status        text not null default 'rascunho',  -- rascunho | ativo | arquivado
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists templates_marketing_canal_idx on public.templates_marketing (canal, status);
alter table public.templates_marketing enable row level security;
revoke all on public.templates_marketing from anon, authenticated;

-- Endereço na base — pré-requisito da mala direta.
alter table public.leads_marketing
  add column if not exists cep text,
  add column if not exists logradouro text,
  add column if not exists numero text,
  add column if not exists complemento text,
  add column if not exists bairro text;

create table if not exists public.automacoes_marketing (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  descricao     text,
  gatilho       text not null,                     -- lead_novo | pedido_parado | pos_compra | lead_frio
  gatilho_dias  integer not null default 3,
  publico       jsonb not null default '{}',
  max_toques    integer not null default 3,
  hora_inicio   integer not null default 9,        -- janela de envio (America/Recife)
  hora_fim      integer not null default 20,
  status        text not null default 'rascunho',  -- rascunho | ativa | pausada
  ultima_rodada_em timestamptz,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists automacoes_marketing_status_idx on public.automacoes_marketing (status);
alter table public.automacoes_marketing enable row level security;
revoke all on public.automacoes_marketing from anon, authenticated;

create table if not exists public.automacao_passos (
  id           uuid primary key default gen_random_uuid(),
  automacao_id uuid not null references public.automacoes_marketing(id) on delete cascade,
  ordem        integer not null,
  espera_dias  integer not null default 0,
  template_id  uuid references public.templates_marketing(id) on delete restrict,
  ativo        boolean not null default true,
  criado_em    timestamptz not null default now(),
  unique (automacao_id, ordem)
);
create index if not exists automacao_passos_idx on public.automacao_passos (automacao_id, ordem);
alter table public.automacao_passos enable row level security;
revoke all on public.automacao_passos from anon, authenticated;

create table if not exists public.automacao_execucoes (
  id           uuid primary key default gen_random_uuid(),
  automacao_id uuid not null references public.automacoes_marketing(id) on delete cascade,
  lead_id      uuid not null references public.leads_marketing(id) on delete cascade,
  passo_ordem  integer not null default 0,
  proximo_em   timestamptz,
  status       text not null default 'ativa',      -- ativa | concluida | saiu
  motivo_saida text,
  enviados     integer not null default 0,
  entrou_em    timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (automacao_id, lead_id)
);
create index if not exists automacao_execucoes_fila_idx on public.automacao_execucoes (status, proximo_em);
alter table public.automacao_execucoes enable row level security;
revoke all on public.automacao_execucoes from anon, authenticated;

alter table public.contatos_marketing
  add column if not exists automacao_id uuid references public.automacoes_marketing(id) on delete set null,
  add column if not exists template_id uuid references public.templates_marketing(id) on delete set null;

-- ─────────────────────────── SEEDS (idempotentes) ───────────────────────────
insert into public.templates_marketing (nome, canal, descricao, corpo, template_meta, template_params, usa_template_oficial, status, tags)
select 'Retomada de pedido parado', 'whatsapp',
  'Template oficial da Meta que leva o cliente direto pro próprio pedido no visualizador.',
  E'Oi, #nome! 👋 Vi que você começou um pedido aqui na Confeccione e ele ficou salvo no meio do caminho. Toca no botão pra abrir o seu pedido e continuar de onde parou — leva menos de 2 minutos. 🧵',
  'retomar_pedido_v3',
  '{"corpo": ["#nome"], "botaoUrl": "#pedido?utm_source=whatsapp&utm_medium=template&utm_campaign=retomada"}'::jsonb,
  true, 'ativo', array['retomada']
where not exists (select 1 from public.templates_marketing where nome = 'Retomada de pedido parado');

insert into public.templates_marketing (nome, canal, descricao, assunto, corpo, status, tags)
select 'Boas-vindas — quem é a Confeccione', 'email',
  'Primeiro contato com quem acabou de entrar na base.',
  'Prazer, #nome — a Confeccione produz sua roupa no Brasil',
  E'Oi, #nome!\n\nA Confeccione conecta quem precisa de roupa produzida com quem produz de verdade: confecções brasileiras já verificadas por nós.\n\nVocê monta o pedido em minutos, recebe o mockup pra aprovar e a gente busca a confecção certa pro seu tipo de peça e pro seu volume. Sem intermediário sumindo com o seu dinheiro.\n\nQuando tiver uma peça em mente, é só responder este e-mail que eu te ajudo a montar o orçamento.',
  'rascunho', array['boas-vindas']
where not exists (select 1 from public.templates_marketing where nome = 'Boas-vindas — quem é a Confeccione');

insert into public.templates_marketing (nome, canal, descricao, assunto, corpo, status, tags)
select 'Pós-compra — como foi a produção?', 'email',
  'Agradecimento e pedido de feedback logo depois da entrega.',
  '#nome, como ficou a sua produção?',
  E'Oi, #nome!\n\nSua produção passou pela gente e eu queria saber, de verdade, como ficou: a peça veio do jeito que você esperava? O prazo bateu?\n\nÉ só responder este e-mail — leio todas.\n\nE se já estiver pensando na próxima grade, me chama que eu adianto o orçamento com a mesma confecção.',
  'rascunho', array['pos-compra']
where not exists (select 1 from public.templates_marketing where nome = 'Pós-compra — como foi a produção?');

insert into public.templates_marketing (nome, canal, descricao, assunto, corpo, status, tags)
select 'Reengajamento — faz tempo que não conversamos', 'email',
  'Toque espaçado pra quem está na base há muito tempo e nunca fechou.',
  '#nome, sua próxima produção pode sair este mês',
  E'Oi, #nome!\n\nFaz um tempo que a gente não conversa. De lá pra cá entrou confecção nova na plataforma e o prazo médio caiu.\n\nSe você ainda tem aquela peça na cabeça, responde aqui com a quantidade e o modelo que eu te mando o orçamento sem compromisso.',
  'rascunho', array['reengajamento']
where not exists (select 1 from public.templates_marketing where nome = 'Reengajamento — faz tempo que não conversamos');

insert into public.automacoes_marketing (nome, descricao, gatilho, gatilho_dias, publico, max_toques, status)
select 'Retomada de pedido parado',
  'Quem montou pedido no chat, não pagou e ficou parado. Substitui a antiga nutrição automática.',
  'pedido_parado', 3, '{"canal": "whatsapp"}'::jsonb, 2, 'pausada'
where not exists (select 1 from public.automacoes_marketing where nome = 'Retomada de pedido parado');

insert into public.automacao_passos (automacao_id, ordem, espera_dias, template_id)
select a.id, 1, 0, t.id
from public.automacoes_marketing a, public.templates_marketing t
where a.nome = 'Retomada de pedido parado'
  and t.nome = 'Retomada de pedido parado'
  and not exists (select 1 from public.automacao_passos p where p.automacao_id = a.id and p.ordem = 1);
