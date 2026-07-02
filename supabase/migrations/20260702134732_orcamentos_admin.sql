-- ============================================================================
-- Orçamentos avulsos do admin (gerador de orçamento em PDF)
-- orcamentos: um registro por orçamento gerado no /admin/orcamentos.
-- numero: ORC-<ano>-<seq 4 dígitos>, gerado pelo DEFAULT da coluna (sequence
--   orcamentos_numero_seq + ano America/Recife) — atômico, sem corrida.
-- Valores em centavos (integer), padrão do projeto.
-- RLS ligada SEM policies: acesso apenas via service role (server) — anon nega.
-- ============================================================================

create sequence orcamentos_numero_seq;

create table orcamentos (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique
    default 'ORC-' || to_char(now() at time zone 'America/Recife', 'YYYY')
      || '-' || lpad(nextval('orcamentos_numero_seq')::text, 4, '0'),
  cliente_nome text,
  cliente_documento text,
  itens jsonb not null default '[]',
  frete_centavos integer not null default 0,
  subtotal_centavos integer not null default 0,
  total_centavos integer not null default 0,
  observacoes text,
  data_orcamento date not null default current_date,
  validade date,
  status text not null default 'gerado',
  criado_em timestamptz not null default now()
);

comment on column orcamentos.itens is
  'Itens do orçamento [{tipo:''produto''|''servico'', descricao, quantidade, valor_unitario_centavos, subtotal_centavos}] — subtotal_centavos = quantidade * valor_unitario_centavos.';

create index orcamentos_criado_idx on orcamentos (criado_em desc);

alter table orcamentos enable row level security;
