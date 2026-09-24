-- A cutucada de captação sai UMA vez por candidato — app/lib/cutucada-captacao.ts (17/09/2026).
-- Confecção que respondeu à sondagem e parou de escrever recebe uma pergunta curta,
-- dentro da janela de 24h; esta marca é o que garante que nunca recebe duas.
alter table public.captacao_fornecedores add column if not exists cutucada_em timestamptz;
comment on column public.captacao_fornecedores.cutucada_em is 'Quando o agente cutucou a confecção que respondeu e sumiu (uma vez só).';
