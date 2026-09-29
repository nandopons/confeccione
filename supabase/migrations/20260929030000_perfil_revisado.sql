-- Revisão semestral do portfólio da confecção — 29/09/2026 (decisão do Fernando):
-- "a cada 6 meses a gente conversa com eles: manda os tipos de produto que a
-- gente tem deles e pergunta se entrou algo novo ou se querem tirar algum".
-- Qualquer salvar_perfil_producao também carimba (entrevista conta como revisão).
-- Ver app/lib/revisao-perfil.ts.
alter table public.leads_fornecedores add column if not exists perfil_revisado_em timestamptz;
comment on column public.leads_fornecedores.perfil_revisado_em is
  'Última vez que a lista de peças foi confirmada com a confecção (entrevista do Luigi ou revisão semestral). Null = nunca.';
-- Backfill: quem já foi entrevistada pelo Luigi não é perguntada de novo agora.
update public.leads_fornecedores f
set perfil_revisado_em = greatest(p.atualizado_em, p.respondido_em)
from public.perfil_producao p
where p.fornecedor_id = f.id and f.perfil_revisado_em is null
  and coalesce(p.atualizado_em, p.respondido_em) is not null;
