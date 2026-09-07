-- ============================================================================
-- ORÇAMENTO ATRASADO SÓ DEPOIS DE 7 DIAS (decisão D-9, 07/09/2026).
--
-- Ajuste da D-8: negociação entre cliente e fornecedor leva dias por natureza;
-- 48 h gerava alerta falso (34 pedidos). Aos 3 dias em negociação o que cabe é
-- perguntar ao cliente se a conversa deu certo (feedback da negociação); aos 7
-- dias sem orçamento, cutucar o fornecedor. Recria a view inteira (mesmo
-- corpo da 20260908010000, só o prazo muda).
-- ============================================================================

create or replace view public.pedidos_assistente_etapas as
with base as (
  select
    p.*,
    exists (
      select 1 from jsonb_array_elements(coalesce(p.linhas, '[]'::jsonb)) l
      where coalesce(l->>'modelo', '') <> ''
        and coalesce(l->>'cor', '') <> ''
        and coalesce(nullif(l->>'total', '')::numeric, 0) > 0
    ) as peca_completa,
    (coalesce(p.nome, '') <> '' and length(regexp_replace(coalesce(p.telefone, ''), '\D', '', 'g')) >= 10) as contato_ok,
    right(regexp_replace(coalesce(p.telefone, ''), '\D', '', 'g'), 8) as tel8
  from public.pedidos_assistente p
),
ofe as (
  select
    o.pedido_id,
    bool_or(o.status = 'aceita') as aceita,
    max(coalesce(o.respondido_em, o.criado_em)) filter (where o.status = 'aceita') as aceita_em,
    count(*) filter (where o.status = 'ofertada') as no_ar,
    count(*) filter (where o.status = 'recusada') as recusadas,
    count(*) as total,
    min(o.criado_em) as primeira_em,
    max(o.criado_em) as ultima_em
  from public.ofertas_pedido_assistente o
  group by o.pedido_id
),
prod as (
  select
    pp.pedido_id,
    bool_or(pp.arquivado_em is null and pp.etapa = 'pronto') as pronto,
    bool_or(pp.arquivado_em is null and pp.etapa <> 'pronto') as ativo,
    -- todos os cards arquivados = produção entregue (o arquivamento é o "acabou" de hoje)
    (count(*) > 0 and bool_and(pp.arquivado_em is not null)) as entregue,
    max(pp.arquivado_em) as arquivado_em,
    max(pp.entrou_etapa_em) as entrou_em
  from public.producao_pedido pp
  group by pp.pedido_id
),
wa as (
  select
    b.id as pedido_id,
    max(m.criado_em) filter (where m.direcao = 'entrada') as cliente_em,
    max(m.criado_em) filter (where m.direcao = 'saida') as nosso_em
  from base b
  join public.wa_contatos c on b.tel8 <> '' and right(c.wa_id, 8) = b.tel8
  join public.wa_conversas cv on cv.contato_id = c.id
  join public.wa_mensagens m on m.conversa_id = cv.id
  group by b.id
),
ld as (
  select l.pedido_id, max(l.ultimo_contato_em) as ultimo_contato_em
  from public.leads_marketing l
  where l.pedido_id is not null
  group by l.pedido_id
),
calc as (
  select
    b.*,
    coalesce(o.aceita, false) as oferta_aceita,
    o.aceita_em,
    coalesce(o.no_ar, 0) as ofertas_no_ar,
    coalesce(o.recusadas, 0) as ofertas_recusadas,
    coalesce(o.total, 0) as ofertas_total,
    o.primeira_em as primeira_oferta_em,
    o.ultima_em as ultima_oferta_em,
    coalesce(pr.pronto, false) as prod_pronto,
    coalesce(pr.ativo, false) as prod_ativo,
    coalesce(pr.entregue, false) as prod_entregue,
    pr.arquivado_em as prod_arquivado_em,
    pr.entrou_em as prod_entrou_em,
    wa.cliente_em as ultimo_contato_cliente_em,
    greatest(b.atualizado_em, wa.nosso_em, ld.ultimo_contato_em) as ultimo_toque_em,
    -- momento em que o orçamento ficou definido (pedidos antigos só têm a cobrança gerada)
    case when b.orcamento_status = 'definido' or b.pagamento_status = 'gerado'
         then coalesce(b.orcamento_definido_em, b.atualizado_em) end as definido_em
  from base b
  left join ofe o on o.pedido_id = b.id
  left join prod pr on pr.pedido_id = b.id
  left join wa on wa.pedido_id = b.id
  left join ld on ld.pedido_id = b.id
),
etapa as (
  select
    c.*,
    case
      when c.status = 'cancelado' then 'cancelado'
      when c.encerrado_em is not null then 'encerrado'
      when c.finalizado_em is not null then 'finalizado'
      when c.pagamento_status = 'pago' and c.prod_entregue then 'entregue'
      when c.pagamento_status = 'pago' and c.prod_pronto then 'pronto'
      when c.pagamento_status = 'pago' and c.prod_ativo then 'em_producao'
      when c.pagamento_status = 'pago' then 'pago'
      when c.definido_em is not null then
        case
          when c.definido_em < now() - interval '21 days' then 'orcamento_vencido'
          when greatest(c.definido_em, coalesce(c.ultimo_contato_cliente_em, c.definido_em)) < now() - interval '3 days' then 'sem_resposta'
          else 'aguardando_pagamento'
        end
      when c.oferta_aceita then
        case
          when coalesce(c.aceita_em, c.ultima_oferta_em, c.atualizado_em) < now() - interval '7 days' then 'orcamento_atrasado'
          else 'em_negociacao'
        end
      when c.status = 'confirmado' or c.ofertas_total > 0 then
        case
          when coalesce(c.confirmado_em, c.primeira_oferta_em, c.criado_em) < now() - interval '24 hours'
               and coalesce(c.ultima_oferta_em, c.criado_em) < now() - interval '24 hours'
            then 'sem_fornecedor'
          else 'buscando_fornecedor'
        end
      when not c.contato_ok then 'rascunho'
      when coalesce(c.ultimo_toque_em, c.criado_em) < now() - interval '30 days' then 'inativo'
      when c.peca_completa then 'pedido_completo'
      else 'captado'
    end as etapa
  from calc c
)
select
  e.id, e.codigo, e.numero, e.nome, e.telefone, e.email, e.uf, e.cidade, e.categoria, e.origem,
  e.status, e.orcamento_status, e.pagamento_status,
  e.valor_centavos, e.repasse_centavos,
  e.criado_em, e.atualizado_em, e.confirmado_em, e.orcamento_definido_em, e.finalizado_em,
  e.encerrado_em, e.encerrado_motivo, e.encerrado_por, e.motivo_parada, e.motivo_parada_em,
  e.linhas,
  e.peca_completa, e.contato_ok,
  e.oferta_aceita, e.aceita_em, e.ofertas_no_ar, e.ofertas_recusadas, e.ofertas_total,
  e.ultimo_contato_cliente_em, e.ultimo_toque_em,
  e.etapa,
  case e.etapa
    when 'rascunho' then 'entrada' when 'captado' then 'entrada' when 'pedido_completo' then 'entrada' when 'inativo' then 'entrada'
    when 'buscando_fornecedor' then 'fornecedor' when 'sem_fornecedor' then 'fornecedor'
    when 'em_negociacao' then 'negociacao' when 'orcamento_atrasado' then 'negociacao'
    when 'aguardando_pagamento' then 'pagamento' when 'sem_resposta' then 'pagamento' when 'orcamento_vencido' then 'pagamento'
    when 'pago' then 'producao' when 'em_producao' then 'producao' when 'pronto' then 'producao' when 'entregue' then 'producao'
    when 'finalizado' then 'fechado'
    else 'perdido'
  end as grupo,
  (e.etapa in ('sem_fornecedor', 'orcamento_atrasado', 'sem_resposta')) as alerta,
  -- desde: quando o pedido entrou na etapa atual
  case e.etapa
    when 'cancelado' then e.atualizado_em
    when 'encerrado' then e.encerrado_em
    when 'finalizado' then e.finalizado_em
    when 'entregue' then coalesce(e.prod_arquivado_em, e.atualizado_em)
    when 'pronto' then coalesce(e.prod_entrou_em, e.atualizado_em)
    when 'em_producao' then coalesce(e.prod_entrou_em, e.atualizado_em)
    when 'pago' then e.atualizado_em
    when 'orcamento_vencido' then e.definido_em + interval '21 days'
    when 'sem_resposta' then greatest(e.definido_em, coalesce(e.ultimo_contato_cliente_em, e.definido_em)) + interval '3 days'
    when 'aguardando_pagamento' then e.definido_em
    when 'orcamento_atrasado' then coalesce(e.aceita_em, e.ultima_oferta_em, e.atualizado_em) + interval '7 days'
    when 'em_negociacao' then coalesce(e.aceita_em, e.ultima_oferta_em, e.atualizado_em)
    when 'sem_fornecedor' then greatest(coalesce(e.confirmado_em, e.primeira_oferta_em, e.criado_em), coalesce(e.ultima_oferta_em, e.criado_em)) + interval '24 hours'
    when 'buscando_fornecedor' then coalesce(e.confirmado_em, e.primeira_oferta_em, e.criado_em)
    when 'inativo' then coalesce(e.ultimo_toque_em, e.criado_em) + interval '30 days'
    when 'pedido_completo' then e.atualizado_em
    else e.criado_em
  end as desde
from etapa e;

comment on view public.pedidos_assistente_etapas is
  'A etapa de cada pedido do site, derivada dos fatos (D-8). Única leitura de estado pra admin, placar, filas, agente e automações. Acesso só via service_role.';

revoke all on public.pedidos_assistente_etapas from anon, authenticated;

