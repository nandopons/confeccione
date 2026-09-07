-- ============================================================================
-- E-mail montado por BLOCOS no editor visual do painel (já aplicada em prod).
--
-- formato_email='texto'  → corpo em parágrafos (o que os templates seed usam)
-- formato_email='blocos' → o corpo visual vem de `blocos`; `corpo` continua
--                          guardando a versão em texto puro, que serve de
--                          fallback no e-mail (todo HTML precisa de um par em
--                          texto, senão pontua mal em filtro de spam) e é o
--                          que fica no histórico de contatos do lead.
--
-- O nome é formato_email, e não formato, porque `formato` já é o formato da
-- PEÇA de mala direta (panfleto/catálogo/carta).
--
-- Bucket 'marketing' é PÚBLICO de propósito: cliente de e-mail baixa imagem
-- sem cookie e sem token, então URL assinada não serviria.
-- ============================================================================

alter table public.templates_marketing
  add column if not exists formato_email text not null default 'texto',
  add column if not exists blocos jsonb not null default '[]';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marketing', 'marketing', true, 5242880,
        array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'])
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
