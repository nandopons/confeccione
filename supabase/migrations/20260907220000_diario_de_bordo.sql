-- ============================================================================
-- DIÁRIO DE BORDO — a memória de gestão da Confeccione (aplicada em prod).
--
-- Três coisas que hoje moram espalhadas (documento no projeto, memória do
-- assistente, cabeça do Fernando) passam a viver no mesmo banco que os números
-- que as embasam:
--
--   placar_semanal  → a foto dos indicadores toda segunda. Hoje vira semana
--                     zero; em dois meses existe tendência, não só leitura.
--   decisoes        → registro de decisão: o que foi decidido, alternativas
--                     descartadas, motivo, número que embasou, quando revisar.
--   reunioes        → a ata: segunda (placar + prioridades), sexta
--                     (fechamento), mensal (financeiro) e sessões de trabalho.
--
-- Quem escreve: o admin (/admin/diario) e o servidor MCP do site (/api/mcp),
-- os dois via service role. Quem lê: o briefing das 06:45, a reunião de
-- segunda e qualquer sessão do Claude — é isso que faz virar "memória
-- consultada constantemente" em vez de cemitério de atas.
--
-- calcular_placar() é a única fonte dos nove indicadores: o admin, o MCP e o
-- cron chamam a mesma função, então o número é o mesmo em toda tela.
-- ============================================================================

-- ─── placar_semanal ─────────────────────────────────────────────────────────

create table if not exists public.placar_semanal (
  id             uuid primary key default gen_random_uuid(),
  -- Segunda-feira da semana a que a foto se refere (fuso America/Recife).
  semana_inicio  date not null unique,
  gerado_em      timestamptz not null default now(),
  -- 'admin' | 'mcp' | 'cron' — quem tirou a foto.
  origem         text not null default 'admin',
  -- Saída de calcular_placar() no momento da foto. Guardar o jsonb inteiro
  -- (e não colunas) porque os indicadores vão mudar e a história não pode
  -- quebrar quando mudarem.
  indicadores    jsonb not null,
  observacoes    text
);

comment on table public.placar_semanal is
  'Foto semanal dos indicadores (saída de calcular_placar). Uma linha por semana; regravar substitui. Acesso apenas via service_role.';

create index if not exists placar_semanal_semana_idx on public.placar_semanal (semana_inicio desc);

alter table public.placar_semanal enable row level security;
revoke all on public.placar_semanal from anon, authenticated;

-- ─── reunioes ───────────────────────────────────────────────────────────────

create table if not exists public.reunioes (
  id            uuid primary key default gen_random_uuid(),
  realizada_em  timestamptz not null default now(),
  -- 'segunda' (placar + prioridades) | 'sexta' (fechamento) | 'mensal'
  -- (financeiro) | 'sessao' (sessão de trabalho com o assistente).
  tipo          text not null check (tipo in ('segunda', 'sexta', 'mensal', 'sessao')),
  titulo        text not null,
  pauta         text,
  -- A ata em si, em markdown. Curta: o que foi olhado, o que foi decidido,
  -- o que ficou pendente.
  resumo        text not null,
  -- Números citados na reunião: { "pedidos_30d": 55, ... }. Livre.
  numeros       jsonb,
  -- [{ "descricao": "...", "dono": "Fernando", "prazo": "2026-09-14", "feita": false }]
  pendencias    jsonb not null default '[]'::jsonb,
  -- Foto do placar usada na reunião, quando houve.
  placar_id     uuid references public.placar_semanal(id) on delete set null,
  origem        text not null default 'admin',
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.reunioes is
  'Atas das reuniões de gestão (segunda, sexta, mensal, sessão de trabalho). Acesso apenas via service_role.';

create index if not exists reunioes_realizada_idx on public.reunioes (realizada_em desc);
create index if not exists reunioes_tipo_idx on public.reunioes (tipo, realizada_em desc);

alter table public.reunioes enable row level security;
revoke all on public.reunioes from anon, authenticated;

-- ─── decisoes ───────────────────────────────────────────────────────────────

create table if not exists public.decisoes (
  id              uuid primary key default gen_random_uuid(),
  -- Número humano: "D-12". Só cresce; nunca reaproveitar.
  numero          integer generated always as identity unique,
  decidido_em     date not null default ((now() at time zone 'America/Recife')::date),
  -- 'whatsapp' | 'marketing' | 'produto' | 'fornecedores' | 'financeiro' |
  -- 'engenharia' | 'gestao' — texto livre, mas estes são os vocábulos.
  tema            text not null,
  titulo          text not null,
  -- A decisão em uma ou duas frases, no imperativo do que passa a valer.
  decisao         text not null,
  -- O que estava acontecendo quando foi decidido.
  contexto        text,
  -- Alternativas descartadas e por quê.
  alternativas    text,
  motivo          text,
  -- Indicadores que embasaram: { "pagos_30d": 0, "aguardando_pgto_reais": 11926 }.
  numeros         jsonb,
  status          text not null default 'vigente' check (status in ('vigente', 'revisada', 'revogada')),
  -- Quando olhar de novo. Decisão sem data de revisão vira dogma.
  revisar_em      date,
  substituida_por uuid references public.decisoes(id) on delete set null,
  reuniao_id      uuid references public.reunioes(id) on delete set null,
  -- Documento do projeto que detalha (ex.: claude/sistema-operacional-escala.md).
  documento       text,
  origem          text not null default 'admin',
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);

comment on table public.decisoes is
  'Registro de decisões de gestão (o que, alternativas, motivo, número que embasou, revisão). Acesso apenas via service_role.';

create index if not exists decisoes_status_idx on public.decisoes (status, revisar_em);
create index if not exists decisoes_tema_idx on public.decisoes (tema, decidido_em desc);

alter table public.decisoes enable row level security;
revoke all on public.decisoes from anon, authenticated;

-- ─── calcular_placar ────────────────────────────────────────────────────────
-- Os nove indicadores do placar + guardrails, em duas janelas (7 e 30 dias)
-- terminando em p_ref, mais o estado "agora" (filas abertas). Uma função só
-- pra que admin, MCP e cron mostrem sempre o mesmo número.
--
-- Fluxo assistido (pedidos_assistente) é o fluxo vivo; o clássico (pedidos)
-- está inativo desde jun/2026 e fica de fora de propósito.
-- ============================================================================

create or replace function public.calcular_placar_janela(p_dias integer, p_ref timestamptz default now())
returns jsonb
language sql
stable
as $$
with j as (
  select p_ref - make_interval(days => p_dias) as ini, p_ref as fim
),
site as (
  select
    count(distinct e.sessao_id) as sessoes,
    count(distinct e.sessao_id) filter (where e.gclid is not null or e.utm_medium in ('cpc', 'paid')) as sessoes_pagas,
    count(*) filter (where e.tipo = 'pageview') as pageviews,
    count(*) filter (where e.tipo = 'assistente_iniciado') as assistente_iniciado,
    count(*) filter (where e.tipo = 'pedido_enviado') as pedido_enviado,
    count(*) filter (where e.tipo = 'whatsapp_click') as whatsapp_click
  from eventos_site e, j where e.criado_em >= j.ini and e.criado_em < j.fim
),
ped as (
  select
    count(*) as criados,
    count(*) filter (where p.status = 'confirmado') as confirmados,
    count(*) filter (where p.status in ('em_visualizacao', 'completo')) as pela_metade,
    count(*) filter (where p.status = 'cancelado') as cancelados,
    count(*) filter (where p.orcamento_status = 'definido') as com_orcamento,
    count(*) filter (where p.pagamento_status = 'pago') as pagos,
    coalesce(sum(p.valor_centavos) filter (where p.pagamento_status = 'pago'), 0) as gmv_pago_centavos,
    coalesce(sum(p.repasse_centavos) filter (where p.pagamento_status = 'pago'), 0) as repasse_pago_centavos,
    count(*) filter (where p.status = 'confirmado' and p.orcamento_status = 'definido' and coalesce(p.pagamento_status, '') <> 'pago') as aguardando_pgto,
    coalesce(sum(p.valor_centavos) filter (where p.status = 'confirmado' and p.orcamento_status = 'definido' and coalesce(p.pagamento_status, '') <> 'pago'), 0) as aguardando_pgto_centavos,
    count(*) filter (where p.finalizado_em is not null) as finalizados
  from pedidos_assistente p, j where p.criado_em >= j.ini and p.criado_em < j.fim
),
ofe as (
  select
    count(*) filter (where o.status = 'aceita') as aceitas,
    count(*) filter (where o.status = 'recusada') as recusadas,
    count(*) filter (where o.status = 'cancelada') as canceladas,
    count(*) filter (where o.status = 'ofertada') as no_ar,
    round((percentile_cont(0.5) within group (order by extract(epoch from (o.respondido_em - o.criado_em)) / 60.0))::numeric, 1) as mediana_min_resposta
  from ofertas_pedido_assistente o, j where o.criado_em >= j.ini and o.criado_em < j.fim
),
orc as (
  select
    count(*) filter (where o.pagamento_status = 'pago') as pagos,
    coalesce(sum(o.total_centavos) filter (where o.pagamento_status = 'pago'), 0) as pagos_centavos,
    count(*) filter (where o.pagamento_status = 'gerado') as cobranca_aberta,
    coalesce(sum(o.total_centavos) filter (where o.pagamento_status = 'gerado'), 0) as cobranca_aberta_centavos
  from orcamentos o, j where o.criado_em >= j.ini and o.criado_em < j.fim
),
forn as (
  select
    (select count(*) from leads_fornecedores f where f.status = 'ativo' and f.aprovacao_status = 'aprovado') as ativos,
    (select count(*) from leads_fornecedores f, j where f.criado_em >= j.ini and f.criado_em < j.fim) as novos,
    (select count(distinct o.fornecedor_id) from ofertas_pedido_assistente o, j where o.respondido_em >= j.ini and o.respondido_em < j.fim) as responderam
),
wa_in as (
  select i.conversa_id, i.criado_em as entrada,
    (select min(s.criado_em) from wa_mensagens s
      where s.conversa_id = i.conversa_id and s.direcao = 'saida' and s.criado_em > i.criado_em) as saida
  from wa_mensagens i, j
  where i.direcao = 'entrada' and i.criado_em >= j.ini and i.criado_em < j.fim
),
atend as (
  select
    (select count(*) from wa_in) as entradas,
    (select count(*) from wa_in where saida is null) as sem_resposta,
    (select round((percentile_cont(0.5) within group (order by extract(epoch from (saida - entrada)) / 60.0))::numeric, 1) from wa_in where saida is not null) as mediana_min,
    (select round((percentile_cont(0.9) within group (order by extract(epoch from (saida - entrada)) / 60.0))::numeric, 1) from wa_in where saida is not null) as p90_min,
    (select count(*) from wa_mensagens m, j where m.criado_em >= j.ini and m.criado_em < j.fim and m.direcao = 'saida') as saidas,
    (select count(*) from wa_mensagens m, j where m.criado_em >= j.ini and m.criado_em < j.fim and m.template_nome is not null) as templates,
    (select count(*) from wa_mensagens m, j where m.criado_em >= j.ini and m.criado_em < j.fim and m.erro is not null) as erros
),
nutri as (
  select
    (select count(*) from leads_marketing) as leads_total,
    (select count(*) from leads_marketing l, j where l.criado_em >= j.ini and l.criado_em < j.fim) as leads_novos,
    (select count(*) from leads_marketing l where l.ultimo_contato_em is not null) as com_primeiro_toque,
    (select count(*) from leads_marketing l where l.opt_out) as opt_out,
    (select count(*) from campanha_envios c, j where c.enviado_em >= j.ini and c.enviado_em < j.fim and c.status = 'enviado') as disparos_campanha,
    (select coalesce(sum(a.enviados), 0) from automacao_execucoes a, j where a.entrou_em >= j.ini and a.entrou_em < j.fim) as disparos_automacao
),
guard as (
  select
    (select round(coalesce(sum(u.custo_micro), 0) / 100000.0, 2) from uso_ia u, j where u.criado_em >= j.ini and u.criado_em < j.fim) as ia_usd,
    (select count(*) from uso_ia u, j where u.criado_em >= j.ini and u.criado_em < j.fim) as ia_chamadas,
    (select count(*) from cron_execucoes c, j where c.executado_em >= j.ini and c.executado_em < j.fim and c.ok = false) as cron_falhas,
    (select coalesce(jsonb_agg(jsonb_build_object('erro', e.erro, 'n', e.n) order by e.n desc), '[]'::jsonb)
       from (select left(m.erro, 80) as erro, count(*) as n from wa_mensagens m, j
             where m.erro is not null and m.criado_em >= j.ini and m.criado_em < j.fim
             group by 1 order by 2 desc limit 3) e) as wa_erros_top
)
select jsonb_build_object(
  'dias', p_dias,
  'inicio', (select ini from j),
  'fim', (select fim from j),
  'site', (select to_jsonb(site) from site),
  'pedidos', (select to_jsonb(ped) from ped),
  'ofertas', (select to_jsonb(ofe) from ofe),
  'orcamentos_avulsos', (select to_jsonb(orc) from orc),
  'fornecedores', (select to_jsonb(forn) from forn),
  'atendimento', (select to_jsonb(atend) from atend),
  'nutricao', (select to_jsonb(nutri) from nutri),
  'guardrails', (select to_jsonb(guard) from guard)
);
$$;

-- Estado "agora": filas abertas independentes de janela. É o que vira alerta.
create or replace function public.calcular_placar_agora(p_ref timestamptz default now())
returns jsonb
language sql
stable
as $$
select jsonb_build_object(
  'confirmados_sem_aceite_24h', (
    select count(*) from pedidos_assistente p
    where p.status = 'confirmado'
      and coalesce(p.pagamento_status, '') <> 'pago'
      and coalesce(p.confirmado_em, p.criado_em) < p_ref - interval '24 hours'
      and not exists (select 1 from ofertas_pedido_assistente o where o.pedido_id = p.id and o.status = 'aceita')
  ),
  'aguardando_pgto_total', (
    select count(*) from pedidos_assistente p
    where p.status = 'confirmado' and p.orcamento_status = 'definido' and coalesce(p.pagamento_status, '') <> 'pago'
  ),
  'aguardando_pgto_total_centavos', (
    select coalesce(sum(p.valor_centavos), 0) from pedidos_assistente p
    where p.status = 'confirmado' and p.orcamento_status = 'definido' and coalesce(p.pagamento_status, '') <> 'pago'
  ),
  'aguardando_pgto_mais_3d', (
    select count(*) from pedidos_assistente p
    where p.status = 'confirmado' and p.orcamento_status = 'definido' and coalesce(p.pagamento_status, '') <> 'pago'
      and p.orcamento_definido_em < p_ref - interval '3 days'
  ),
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
  'em_producao', (select count(*) from producao_pedido pp where pp.arquivado_em is null and pp.etapa <> 'pronto'),
  'fornecedores_pendentes_aprovacao', (select count(*) from leads_fornecedores f where f.aprovacao_status = 'pendente'),
  'decisoes_para_revisar', (
    select count(*) from decisoes d where d.status = 'vigente' and d.revisar_em is not null and d.revisar_em <= (p_ref at time zone 'America/Recife')::date
  )
);
$$;

create or replace function public.calcular_placar(p_ref timestamptz default now())
returns jsonb
language sql
stable
as $$
select jsonb_build_object(
  'referencia', p_ref,
  'semana_inicio', (date_trunc('week', (p_ref at time zone 'America/Recife')))::date,
  'd7', public.calcular_placar_janela(7, p_ref),
  'd30', public.calcular_placar_janela(30, p_ref),
  'agora', public.calcular_placar_agora(p_ref)
);
$$;

comment on function public.calcular_placar(timestamptz) is
  'Os nove indicadores do placar semanal (janelas de 7 e 30 dias) + filas abertas. Única fonte pro admin, MCP e cron.';

revoke execute on function public.calcular_placar_janela(integer, timestamptz) from public, anon, authenticated;
revoke execute on function public.calcular_placar_agora(timestamptz) from public, anon, authenticated;
revoke execute on function public.calcular_placar(timestamptz) from public, anon, authenticated;
