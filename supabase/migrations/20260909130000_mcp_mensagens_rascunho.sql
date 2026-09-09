-- ============================================================================
-- RASCUNHO DE MENSAGEM DO MCP — envio em duas etapas (09/09/2026).
--
-- POR QUE UMA TABELA, E NÃO UM ARGUMENTO SÓ
-- A regra N1 diz que ação com efeito externo entra "uma por vez, com
-- confirmação". Numa ferramenta de passo único a confirmação seria só um
-- booleano na mesma chamada — quem confirma é o modelo, não o Fernando, e o
-- texto que vai pro cliente pode não ser o texto que ele leu.
--
-- Aqui o fluxo é: preparar_mensagem grava o texto EXATO e devolve um id;
-- o Fernando lê; enviar_rascunho manda AQUELE id. O que sai é, byte a byte,
-- o que ele aprovou. Reescrever o texto exige um rascunho novo.
--
-- Como o servidor MCP é stateless (cada POST cria e descarta o servidor), o
-- rascunho não pode viver em memória — daí a tabela.
--
-- EXPIRAÇÃO
-- 30 minutos. Um rascunho velho é perigoso: a conversa andou, a janela de 24 h
-- pode ter fechado e o texto pode ter deixado de fazer sentido. Expirado não
-- envia; prepara de novo.
-- ============================================================================

create table if not exists public.mcp_mensagens_rascunho (
  id                  uuid primary key default gen_random_uuid(),
  wa_id               text        not null,
  nome                text,
  texto               text        not null,
  template_nome       text,
  template_variaveis  jsonb,
  pedido_id           uuid,
  -- Por que esta mensagem está sendo mandada; entra no log pra auditoria.
  contexto            text,
  janela_aberta       boolean     not null,
  criado_em           timestamptz not null default now(),
  expira_em           timestamptz not null default now() + interval '30 minutes',
  enviado_em          timestamptz,
  wamid               text,
  erro                text
);

comment on table  public.mcp_mensagens_rascunho is
  'Mensagem preparada pelo MCP e ainda não enviada. preparar_mensagem grava, enviar_rascunho manda o id. Expira em 30 min.';
comment on column public.mcp_mensagens_rascunho.janela_aberta is
  'Se a janela de 24 h estava aberta na preparação. Fechada => só template aprovado.';
comment on column public.mcp_mensagens_rascunho.enviado_em is
  'Preenchido no envio. Rascunho já enviado não envia de novo (trava anti-duplicata).';

create index if not exists mcp_mensagens_rascunho_pendentes_idx
  on public.mcp_mensagens_rascunho (criado_em desc)
  where enviado_em is null;

-- RLS default-deny: ninguém alcança pelo cliente anônimo. O MCP e as rotas
-- usam a service role, que ignora RLS.
alter table public.mcp_mensagens_rascunho enable row level security;
