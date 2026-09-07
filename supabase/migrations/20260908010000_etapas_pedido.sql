-- ============================================================================
-- ETAPAS DO PEDIDO — uma etapa só, calculada no banco (decisão D-8, 07/09/2026).
--
-- O estado de um pedido do site estava espalhado em cinco lugares (status,
-- orcamento_status, pagamento_status, ofertas, produção) e cada tela lia do
-- seu jeito. A partir daqui existe UMA leitura, a view
-- pedidos_assistente_etapas, derivada dos fatos — nunca gravada à mão (mesmo
-- princípio do abandono do em_oferta: nada de segunda fonte de verdade).
-- Admin, placar, filas, agente e automações leem a mesma etapa.
--
-- Etapas (grupo):
--   rascunho            (entrada)     sem nome + WhatsApp
--   captado             (entrada)     contato ok, peça incompleta (modelo+cor+quantidade)
--   pedido_completo     (entrada)     peça completa, não clicou em "Buscar fornecedor"
--   inativo             (entrada)     captado/completo há 30 dias sem nenhum toque
--   buscando_fornecedor (fornecedor)  confirmou; oferta em andamento (< 24 h)
--   sem_fornecedor  ⚠   (fornecedor)  confirmou há 24 h sem aceite e sem oferta fresca
--   em_negociacao       (negociacao)  oferta aceita, orçamento ainda não definido
--   orcamento_atrasado ⚠(negociacao)  aceite há mais de 48 h sem orçamento
--   aguardando_pagamento(pagamento)   orçamento definido, não pago
--   sem_resposta    ⚠   (pagamento)   3 dias sem mensagem do cliente depois do orçamento
--   orcamento_vencido   (pagamento)   orçamento há mais de 21 dias — sai do valor "aguardando"
--   pago                (producao)    pagou, produção não iniciada
--   em_producao         (producao)    card de produção ativo
--   pronto              (producao)    card na etapa "pronto"
--   entregue            (producao)    todos os cards de produção arquivados
--   finalizado          (fechado)
--   encerrado           (perdido)     decisão humana (ou do Luigi), sempre com motivo
--   cancelado           (perdido)     cliente cancelou
--
-- Prazos (24 h / 48 h / 3 d / 21 d / 30 d) são constantes aqui de propósito:
-- mudar prazo é decisão registrada, não configuração.
-- ============================================================================

-- ─── Fatos novos: encerramento com motivo e motivo de parada ────────────────

alter table public.pedidos_assistente
  add column if not exists encerrado_em     timestamptz,
  add column if not exists encerrado_motivo text,
  add column if not exists encerrado_por    text,
  add column if not exists motivo_parada    text,
  add column if not exists motivo_parada_em timestamptz;

alter table public.pedidos_assistente drop constraint if exists pedidos_assistente_encerrado_motivo_check;
alter table public.pedidos_assistente
  add constraint pedidos_assistente_encerrado_motivo_check
  check (encerrado_motivo is null or encerrado_motivo in ('achou_caro', 'data', 'atendimento', 'sumiu', 'outro'));

comment on column public.pedidos_assistente.encerrado_em is 'Pedido dado como perdido (decisão humana ou do Luigi). Nunca automático.';
comment on column public.pedidos_assistente.encerrado_motivo is 'achou_caro | data | atendimento | sumiu | outro';
comment on column public.pedidos_assistente.encerrado_por is 'admin | luigi | gestor_whatsapp | mcp';
comment on column public.pedidos_assistente.motivo_parada is 'Por que o cliente parou (texto livre), registrado enquanto o pedido ainda está aberto.';

-- ─── A view ─────────────────────────────────────────────────────────────────

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
          when coalesce(c.aceita_em, c.ultima_oferta_em, c.atualizado_em) < now() - interval '48 hours' then 'orcamento_atrasado'
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
    when 'orcamento_atrasado' then coalesce(e.aceita_em, e.ultima_oferta_em, e.atualizado_em) + interval '48 hours'
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

-- ─── Placar: as filas passam a ler a etapa ──────────────────────────────────

create or replace function public.calcular_placar_agora(p_ref timestamptz default now())
returns jsonb
language sql
stable
as $$
with e as (select * from public.pedidos_assistente_etapas)
select jsonb_build_object(
  -- por etapa: a foto completa
  'por_etapa', (select coalesce(jsonb_object_agg(etapa, n), '{}'::jsonb) from (select etapa, count(*) as n from e group by etapa) x),
  'por_etapa_centavos', (select coalesce(jsonb_object_agg(etapa, c), '{}'::jsonb) from (select etapa, coalesce(sum(valor_centavos), 0) as c from e where valor_centavos is not null group by etapa) x),
  -- nomes antigos, agora com a definição nova
  'captados', (select count(*) from e where etapa = 'captado'),
  'pedidos_completos', (select count(*) from e where etapa = 'pedido_completo'),
  'inativos', (select count(*) from e where etapa = 'inativo'),
  'confirmados_sem_aceite_24h', (select count(*) from e where etapa = 'sem_fornecedor'),
  'buscando_fornecedor', (select count(*) from e where etapa = 'buscando_fornecedor'),
  'em_negociacao', (select count(*) from e where etapa in ('em_negociacao', 'orcamento_atrasado')),
  'orcamento_atrasado', (select count(*) from e where etapa = 'orcamento_atrasado'),
  'aguardando_pgto_total', (select count(*) from e where etapa in ('aguardando_pagamento', 'sem_resposta')),
  'aguardando_pgto_total_centavos', (select coalesce(sum(valor_centavos), 0) from e where etapa in ('aguardando_pagamento', 'sem_resposta')),
  'aguardando_pgto_mais_3d', (select count(*) from e where etapa = 'sem_resposta'),
  'orcamento_vencido', (select count(*) from e where etapa = 'orcamento_vencido'),
  'orcamento_vencido_centavos', (select coalesce(sum(valor_centavos), 0) from e where etapa = 'orcamento_vencido'),
  'orcamentos_avulsos_cobranca_aberta', (select count(*) from orcamentos o where o.pagamento_status = 'gerado'),
  'orcamentos_avulsos_cobranca_aberta_centavos', (select coalesce(sum(o.total_centavos), 0) from orcamentos o where o.pagamento_status = 'gerado'),
  'ofertas_no_ar_mais_24h', (
    select count(*) from ofertas_pedido_assistente o where o.status = 'ofertada' and o.criado_em < p_ref - interval '24 hours'
  ),
  'wa_nao_lidas', (select coalesce(sum(c.nao_lidas), 0) from wa_conversas c),
  'wa_sem_resposta_2h', (
    select count(*) from wa_mensagens i
    where i.direcao = 'entrada' and i.criado_em < p_ref - interval '2 hours' and i.criado_em >= p_ref - interval '7 days'
      and not exists (select 1 from wa_mensagens s where s.conversa_id = i.conversa_id and s.direcao = 'saida' and s.criado_em > i.criado_em)
  ),
  'em_producao', (select count(*) from e where etapa in ('pago', 'em_producao', 'pronto')),
  'entregues_sem_finalizar', (select count(*) from e where etapa = 'entregue'),
  'fornecedores_pendentes_aprovacao', (select count(*) from leads_fornecedores f where f.aprovacao_status = 'pendente'),
  'decisoes_para_revisar', (
    select count(*) from decisoes d where d.status = 'vigente' and d.revisar_em is not null and d.revisar_em <= (p_ref at time zone 'America/Recife')::date
  )
);
$$;

revoke execute on function public.calcular_placar_agora(timestamptz) from public, anon, authenticated;
