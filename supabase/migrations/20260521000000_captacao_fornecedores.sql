-- ============================================================================
-- captacao_fornecedores — A TABELA QUE NUNCA TEVE CREATE NO REPO.
--
-- Escrito em 11/09/2026, datado em 21/05/2026 (a linha mais antiga da tabela é
-- de 2026-05-21T17:36) para que o replay numa base nova funcione: a migration
-- 20260908040000_captacao_pedido.sql faz `alter table ... add column if not
-- exists` nesta tabela, e sem um CREATE anterior ela quebra.
--
-- POR QUE ISTO EXISTE
-- A tabela foi criada direto no SQL editor e nunca virou arquivo. O custo
-- apareceu em 11/09: o código grava `status = 'sugerido'` (o banco de reserva
-- da captação, captacao-pedido.ts) e o check constraint da tabela não aceita
-- esse valor. Ninguém viu porque a constraint não estava em lugar nenhum que se
-- lê — nem no repo, nem no code review. Código e banco divergiram em silêncio.
--
-- PROVENIÊNCIA: as colunas, tipos, defaults e nulidade abaixo foram lidos do
-- schema vivo (spec OpenAPI do PostgREST, projeto oumfvryxxxfgflvpqeow) em
-- 11/09/2026. O `if not exists` em tudo torna este arquivo no-op contra a base
-- de produção; ele serve pra base nova e pra deixar a forma registrada.
--
-- O QUE NÃO FOI POSSÍVEL LER pelo PostgREST, e portanto NÃO está aqui:
-- índices e índices únicos. O código em app/api/admin/captacao/route.ts trata
-- erro de insert como "provavelmente e-mail duplicado (índice único)", o que
-- sugere um unique em `email` — mas sugerir não é ler, e inventar constraint
-- que governa dado de produção é pior que omitir. Confirmar com:
--   select indexdef from pg_indexes where tablename = 'captacao_fornecedores';
-- e completar este arquivo.
-- ============================================================================

create table if not exists public.captacao_fornecedores (
  id                uuid        primary key default gen_random_uuid(),
  nome              text,
  email             text,
  whatsapp          text,
  segmento          text        not null,
  -- Passo da cadência de follow-up (0 = convite, 1..n = toques seguintes).
  etapa             integer     not null default 0,
  status            text        not null default 'ativo',
  proximo_envio_em  timestamptz,
  ultimo_envio_em   timestamptz,
  convertido_em     timestamptz,
  canal_email       boolean     not null default true,
  -- Default false de propósito: WhatsApp frio é o canal caro, entra por opção.
  canal_whatsapp    boolean     not null default false,
  erros             integer     not null default 0,
  ultimo_erro       text,
  ator              text,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

-- O vocabulário de status COMO ERA até 11/09. O valor 'sugerido' entra na
-- migration 20260911_captacao_status_sugerido.sql — foi a falta dele que
-- derrubou o banco de reserva.
alter table public.captacao_fornecedores drop constraint if exists captacao_fornecedores_status_check;
alter table public.captacao_fornecedores
  add constraint captacao_fornecedores_status_check
  check (status in ('ativo', 'convertido', 'pausado', 'esgotado', 'erro'));

comment on table public.captacao_fornecedores is
  'Confecção abordada pela captação: manual (admin), puxada por pedido (agente) ou por captador.';

alter table public.captacao_fornecedores enable row level security;
