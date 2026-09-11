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
-- ÍNDICES: o PostgREST não os expõe, então vieram do Fernando lendo
-- `pg_indexes` em 11/09/2026 (ver o bloco no fim do arquivo).
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

-- ─── Índices ────────────────────────────────────────────────────────────────

-- Deduplicação de contato, case-insensitive: é este índice que faz o insert da
-- rota /api/admin/captacao falhar quando o e-mail repete, e é por isso que lá o
-- erro é tratado como "provavelmente e-mail duplicado". Parcial porque candidato
-- sem e-mail (só WhatsApp) é comum e não deve colidir com os outros sem e-mail.
create unique index if not exists idx_captacao_email_unico
  on public.captacao_fornecedores (lower(email))
  where email is not null;

-- A fila da cadência de follow-up.
--
-- ATENÇÃO — este índice é parcial em `status = 'ativo'`, e esse WHERE é uma
-- afirmação sobre o domínio: "ativo é o único estado que entra em fila". A
-- afirmação envelheceu em 10/09/2026, quando o banco de reserva passou a querer
-- enfileirar `status = 'sugerido'` — e é a MESMA raiz que fez o 'sugerido'
-- nascer ilegal no check constraint. Ver 20260911160000_captacao_status_sugerido.sql.
--
-- A definição abaixo é a que existe em produção hoje, registrada aqui como
-- histórico; a discussão sobre trocá-la por um índice sem WHERE está no mesmo
-- arquivo da migration de 11/09.
create index if not exists idx_captacao_fila
  on public.captacao_fornecedores (proximo_envio_em)
  where status = 'ativo';
