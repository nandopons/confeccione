-- "Gostaria de concluir seu pedido?" antes de a janela de 24 h fechar —
-- 29/09/2026 (decisão do Fernando; Icaro 20260900340, Leandro 20260900342).
-- Uma cutucada por silêncio do cliente: a marca fica na conversa e só vale
-- se for posterior à última mensagem dele. Ver app/lib/cutucada-janela.ts.
alter table public.wa_conversas add column if not exists cutucada_janela_em timestamptz;
comment on column public.wa_conversas.cutucada_janela_em is
  'Última vez que o Luigi perguntou "gostaria de concluir seu pedido?" por texto livre dentro da janela de 24 h. Só repete depois de nova mensagem do cliente.';
