-- 29/09/2026 — QUANDO A MENSAGEM CHEGOU AQUI, não quando foi escrita.
--
-- `criado_em` é o timestamp da Meta (a hora em que o cliente mandou). Hoje a
-- Gabi escreveu "Qual valor?" às 19:05 e o turno do Luigi só começou às 19:20;
-- a Gleicy escreveu 18:56 e foi respondida 19:22. Os logs da Vercel não mostram
-- erro nenhum, e sem a hora de CHEGADA não dá pra separar "a Meta entregou
-- atrasado" de "o webhook engoliu". Esta coluna é a régua: recebido_em −
-- criado_em é o atraso da entrega. Default now() cobre o insert do webhook sem
-- mexer em código.
alter table public.wa_mensagens add column if not exists recebido_em timestamptz not null default now();
