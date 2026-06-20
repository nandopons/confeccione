alter table public.leads_fornecedores
  add column if not exists aprovacao_status text not null default 'aprovado',
  add column if not exists aprovacao_em timestamptz,
  add column if not exists aprovacao_motivo text;

update public.leads_fornecedores set aprovacao_status = 'aprovado' where aprovacao_status is null;

create index if not exists idx_leads_fornecedores_aprovacao on public.leads_fornecedores (aprovacao_status);
