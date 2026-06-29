-- ============================================================================
-- Chat do pedido — Áudio + anexos (imagem/arquivo)
-- Data: 2026-06-28
-- ============================================================================
--
-- Estende mensagens_pedido pra carregar mídia (áudio gravado, foto, arquivo)
-- além de texto. A mídia vive num bucket PRIVADO 'mensagens-anexos'; o acesso
-- só sai por URL assinada curta gerada pelos endpoints (service_role), que
-- validam posse do pedido. A tabela guarda só o caminho interno (anexo_path),
-- nunca a URL assinada — então o SELECT anon pré-existente (Realtime) não dá
-- acesso à mídia.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Colunas de anexo em mensagens_pedido (idempotente)
-- ----------------------------------------------------------------------------
alter table public.mensagens_pedido
  add column if not exists tipo text not null default 'texto'
    check (tipo in ('texto', 'audio', 'imagem', 'arquivo')),
  add column if not exists anexo_path text,        -- caminho interno no bucket (sem PII)
  add column if not exists anexo_nome text,         -- nome amigável p/ exibição/download
  add column if not exists anexo_mime text,
  add column if not exists anexo_tamanho bigint check (anexo_tamanho is null or anexo_tamanho >= 0),
  add column if not exists audio_duracao_ms integer check (audio_duracao_ms is null or audio_duracao_ms >= 0);

-- conteudo passa a ser opcional (mensagens de mídia podem não ter texto/legenda)
alter table public.mensagens_pedido alter column conteudo drop not null;

-- Integridade: texto exige conteudo; mídia exige anexo_path.
alter table public.mensagens_pedido
  drop constraint if exists mensagens_pedido_conteudo_ou_anexo;
alter table public.mensagens_pedido
  add constraint mensagens_pedido_conteudo_ou_anexo check (
    (tipo = 'texto' and conteudo is not null) or
    (tipo <> 'texto' and anexo_path is not null)
  );

-- ----------------------------------------------------------------------------
-- 2. Bucket privado mensagens-anexos
--    public=false, sem limite por arquivo / sem whitelist de MIME (validado na
--    app). Espelha o padrão de 'artes-clientes'. Idempotente via ON CONFLICT.
--    Sem policies em storage.objects → anon/authenticated negados por padrão;
--    só o service_role (endpoints) lê/escreve e assina URLs.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mensagens-anexos', 'mensagens-anexos', false, null, null)
on conflict (id) do nothing;
