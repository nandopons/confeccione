-- ============================================================================
-- CORREÇÃO de um erro cometido ao aplicar a migração de blocos em produção.
--
-- O que deu errado: `templates_marketing` JÁ tinha a coluna `formato` (o
-- formato da peça de mala direta). Uma tentativa de criar `formato` para o
-- corpo do e-mail virou no-op silencioso (`add column if not exists`), e o
-- rename seguinte renomeou a coluna ERRADA — a da mala direta virou
-- `formato_email`.
--
-- Consequência: `formato` sumiu; como ela está na lista de colunas que a
-- aplicação seleciona, TODA leitura de templates passou a falhar em silêncio
-- e a lista aparecia vazia ("E-mails 0" na tela), sem erro visível.
--
-- Esta migração conserta um banco que passou por esse estado. Em banco novo,
-- onde a migração 20260907170000 já cria `formato_email` corretamente, ela
-- não faz nada — daí as guardas.
-- ============================================================================

do $$
begin
  -- Só age se o estrago existe: `formato` ausente e `formato_email` presente.
  if not exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'templates_marketing'
           and column_name = 'formato')
     and exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'templates_marketing'
           and column_name = 'formato_email')
  then
    -- devolve a coluna da mala direta ao nome original (os valores são os dela)
    alter table public.templates_marketing rename column formato_email to formato;
    -- e cria a do corpo do e-mail, agora de verdade
    alter table public.templates_marketing
      add column formato_email text not null default 'texto';
    update public.templates_marketing
       set formato_email = 'blocos'
     where jsonb_array_length(blocos) > 0;
  end if;
end $$;
