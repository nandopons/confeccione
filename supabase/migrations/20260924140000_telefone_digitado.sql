-- O número que vai pra confecção é o que a Meta entregou — app/lib/telefone-cliente.ts (24/09/2026).
-- Quando o digitado difere do real (Melissa, 20260900316: "55387531589" vs 553187531589),
-- `telefone` passa a ser o real e o original fica aqui, como rastro.
alter table public.pedidos_assistente add column if not exists telefone_digitado text;
comment on column public.pedidos_assistente.telefone_digitado is 'O telefone como o cliente escreveu, quando difere do que a Meta entregou (telefone passa a ser o real).';
