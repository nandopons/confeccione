-- Sinal de 50% no orçamento avulso (21/08/2026)
--
-- O QUE MUDA
-- Até aqui um orçamento tinha UMA cobrança, e os dados dela moravam em colunas
-- soltas de `orcamentos` (asaas_payment_id, pix_copia_cola, ...). Com 50/50
-- passam a existir dois títulos com vida própria: vencimentos diferentes,
-- status diferentes, e o segundo nem nasce junto com o primeiro — você libera
-- depois, quando a produção justificar.
--
-- POR QUE TABELA E NÃO MAIS COLUNAS
-- Duplicar as seis colunas com sufixo _2 funcionaria hoje e quebraria no dia
-- que aparecer 3x. E mais: baixa manual precisa registrar QUEM deu baixa e
-- POR QUÊ — isso é linha de tabela, não coluna de orçamento.
--
-- AS COLUNAS ANTIGAS DE `orcamentos` CONTINUAM
-- Não removo nada: o PDF e o e-mail já emitidos leem de lá, e reescrever isso
-- agora seria mexer em código que funciona por gosto de arrumação. Elas passam
-- a ser o espelho da PRIMEIRA parcela. A migração abaixo copia o que existe.
--
-- `orcamentos.pagamento_status` = "já dá pra produzir?"
-- No integral, vira 'pago' quando a cobrança é paga. No 50/50, vira 'pago'
-- quando o SINAL é pago — decisão do Fernando (21/08/2026): o sinal cobre o
-- material, então a produção começa ali. O quadro de produção lê essa coluna e
-- não precisou saber de parcela nenhuma.
--
-- APLICADA em produção em 21/08/2026 via MCP.

alter table public.orcamentos
  add column if not exists modalidade text not null default 'integral'
    check (modalidade in ('integral', 'sinal_50')),
  add column if not exists desconto_pix_percentual integer not null default 3
    check (desconto_pix_percentual between 0 and 100);

comment on column public.orcamentos.modalidade is
  'integral = uma cobrança; sinal_50 = duas parcelas de 50%.';
comment on column public.orcamentos.desconto_pix_percentual is
  'Desconto até o vencimento. Vale só no integral — sinal e parcela final sempre saem cheios, porque o desconto é o prêmio de quem paga tudo de uma vez.';

create table if not exists public.orcamento_cobrancas (
  id                 uuid primary key default gen_random_uuid(),
  orcamento_id       uuid not null references public.orcamentos(id) on delete cascade,
  parcela            integer not null check (parcela in (1, 2)),
  rotulo             text not null check (rotulo in ('integral', 'sinal', 'final')),
  valor_centavos     integer not null check (valor_centavos > 0),
  desconto_percentual integer not null default 0 check (desconto_percentual between 0 and 100),
  vencimento         date,

  asaas_payment_id   text,
  asaas_invoice_url  text,
  pix_copia_cola     text,
  pix_qr_imagem      text,

  status             text not null default 'gerada'
                     check (status in ('gerada', 'paga', 'cancelada')),
  pago_em            timestamptz,

  -- Como a baixa aconteceu. 'manual' é o caso do cliente que fez PIX direto
  -- na chave, fora do Asaas — acontece, e negar isso só faria você anotar
  -- em outro lugar.
  origem_baixa       text check (origem_baixa in ('asaas', 'manual')),
  baixa_motivo       text,

  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now(),

  constraint orcamento_cobrancas_orcamento_parcela_uk unique (orcamento_id, parcela)
);

comment on table public.orcamento_cobrancas is
  'Títulos de um orçamento avulso. Uma linha no integral; duas no 50/50 (sinal e final).';
comment on column public.orcamento_cobrancas.origem_baixa is
  'asaas = confirmado pelo gateway (webhook ou reconciliação); manual = você marcou na mão, com motivo.';

create index if not exists orcamento_cobrancas_orcamento_idx on public.orcamento_cobrancas (orcamento_id, parcela);
create index if not exists orcamento_cobrancas_asaas_idx on public.orcamento_cobrancas (asaas_payment_id);
create index if not exists orcamento_cobrancas_status_idx on public.orcamento_cobrancas (status);

alter table public.orcamento_cobrancas enable row level security;
revoke all on public.orcamento_cobrancas from anon, authenticated;

-- Traz o que já existe pra dentro do modelo novo, como parcela única.
insert into public.orcamento_cobrancas
  (orcamento_id, parcela, rotulo, valor_centavos, desconto_percentual, vencimento,
   asaas_payment_id, asaas_invoice_url, pix_copia_cola, pix_qr_imagem,
   status, pago_em, origem_baixa, criado_em)
select o.id, 1, 'integral',
       greatest(coalesce(o.total_centavos, 0), 1),
       3, o.cobranca_vencimento,
       o.asaas_payment_id, o.asaas_invoice_url, o.pix_copia_cola, o.pix_qr_imagem,
       case when o.pagamento_status = 'pago' then 'paga' else 'gerada' end,
       o.pago_em,
       case when o.pagamento_status = 'pago' then 'asaas' end,
       o.criado_em
from public.orcamentos o
where o.asaas_payment_id is not null
  and not exists (select 1 from public.orcamento_cobrancas c where c.orcamento_id = o.id);
