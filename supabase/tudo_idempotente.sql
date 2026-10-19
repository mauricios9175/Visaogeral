-- Todas as migrações (0001 a 0006) num script só, seguro para rodar mais de uma vez:
-- cria apenas o que estiver faltando e não apaga dados.

create extension if not exists pgcrypto;

-- 0001: base
create table if not exists clientes (
  id                uuid primary key default gen_random_uuid(),
  nome              text not null,
  nicho             text,
  cpl_meta          numeric(12,2),
  orcamento_mensal  numeric(12,2),
  roas_meta         numeric(8,2),
  ativo             boolean not null default true,
  criado_em         timestamptz not null default now()
);

create table if not exists tokens_meta (
  id            uuid primary key default gen_random_uuid(),
  fb_user_id    text not null unique,
  nome          text,
  token         text not null,
  expira_em     timestamptz,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists contas_anuncio (
  id            text primary key,
  cliente_id    uuid references clientes(id) on delete set null,
  nome          text not null,
  moeda         text,
  fuso          text,
  status        int,
  bm_nome       text,
  origem        text not null check (origem in ('bm', 'usuario')),
  token_id      uuid references tokens_meta(id) on delete set null,
  ativa_sync    boolean not null default true,
  ultima_sync   timestamptz,
  ultimo_erro   text,
  criado_em     timestamptz not null default now()
);
create index if not exists contas_anuncio_cliente_id_idx on contas_anuncio (cliente_id);

create table if not exists metricas_diarias (
  conta_id        text not null references contas_anuncio(id) on delete cascade,
  data            date not null,
  ad_id           text not null,
  ad_nome         text,
  adset_id        text,
  adset_nome      text,
  campaign_id     text,
  campaign_nome   text,
  gasto           numeric(14,2) not null default 0,
  impressoes      bigint not null default 0,
  alcance         bigint not null default 0,
  cliques         bigint not null default 0,
  cliques_link    bigint not null default 0,
  leads           int not null default 0,
  conversas       int not null default 0,
  compras         int not null default 0,
  valor_compras   numeric(14,2) not null default 0,
  atualizado_em   timestamptz not null default now(),
  primary key (conta_id, data, ad_id)
);
create index if not exists metricas_diarias_data_idx on metricas_diarias (data);
create index if not exists metricas_diarias_conta_campanha_idx on metricas_diarias (conta_id, campaign_id);

create table if not exists sync_execucoes (
  id            bigint generated always as identity primary key,
  modo          text not null,
  iniciado_em   timestamptz not null default now(),
  finalizado_em timestamptz,
  status        text not null default 'rodando',
  contas        int default 0,
  linhas        int default 0,
  erros         text
);

-- 0002: saldo das contas
alter table contas_anuncio add column if not exists pre_paga     boolean;
alter table contas_anuncio add column if not exists saldo        numeric(14,2);
alter table contas_anuncio add column if not exists saldo_texto  text;
alter table contas_anuncio add column if not exists limite_gasto numeric(14,2);
alter table contas_anuncio add column if not exists total_gasto  numeric(14,2);
alter table contas_anuncio add column if not exists saldo_em     timestamptz;

-- 0003: resultados por tipo
alter table metricas_diarias add column if not exists resultados     numeric(14,2) not null default 0;
alter table metricas_diarias add column if not exists resultado_tipo text;
alter table metricas_diarias add column if not exists resultado_acao text;

drop view if exists vw_cliente_dia;
create view vw_cliente_dia as
select
  c.cliente_id,
  m.data,
  sum(m.gasto)          as gasto,
  sum(m.impressoes)     as impressoes,
  sum(m.alcance)        as alcance,
  sum(m.cliques)        as cliques,
  sum(m.cliques_link)   as cliques_link,
  sum(m.leads)          as leads,
  sum(m.conversas)      as conversas,
  sum(m.compras)        as compras,
  sum(m.valor_compras)  as valor_compras,
  sum(case when m.resultado_tipo = 'conversas' then m.resultados
           when m.resultado_tipo is null then m.conversas else 0 end)           as res_conversas,
  sum(case when m.resultado_tipo = 'formulario' then m.resultados else 0 end)    as res_formulario,
  sum(case when m.resultado_tipo = 'lead_site' then m.resultados
           when m.resultado_tipo is null then m.leads else 0 end)               as res_lead_site,
  sum(case when m.resultado_tipo = 'conv_personalizada' then m.resultados else 0 end) as res_conv_personalizada,
  sum(case when m.resultado_tipo = 'compras' then m.resultados else 0 end)       as res_compras,
  sum(case when m.resultado_tipo = 'cadastro' then m.resultados else 0 end)      as res_cadastro,
  sum(case when m.resultado_tipo = 'outros' then m.resultados else 0 end)        as res_outros
from metricas_diarias m
join contas_anuncio c on c.id = m.conta_id
where c.cliente_id is not null
group by c.cliente_id, m.data;

-- 0004: status de campanhas, conjuntos e anúncios
create table if not exists status_meta (
  id             text primary key,
  conta_id       text not null references contas_anuncio(id) on delete cascade,
  nivel          text not null check (nivel in ('campanha', 'conjunto', 'anuncio')),
  status         text not null,
  atualizado_em  timestamptz not null default now()
);
create index if not exists status_meta_conta_id_idx on status_meta (conta_id);

-- 0005: CRM
create table if not exists crm_conexoes (
  cliente_id              uuid primary key references clientes(id) on delete cascade,
  tipo                    text not null check (tipo in ('rd_crm', 'kommo')),
  token                   text not null,
  subdominio              text,
  pipeline_id             text,
  pipeline_nome           text,
  etapa_qualificado       text,
  etapa_qualificado_nome  text,
  etapa_qualificado_ordem int,
  ultima_sync             timestamptz,
  ultimo_erro             text,
  criado_em               timestamptz not null default now()
);

create table if not exists crm_negocios (
  id              text primary key,
  cliente_id      uuid not null references clientes(id) on delete cascade,
  pipeline_id     text,
  nome            text,
  criado_em       timestamptz not null,
  fechado_em      timestamptz,
  etapa_id        text,
  etapa_nome      text,
  etapa_ordem     int,
  ganho           boolean,
  valor           numeric(14,2) not null default 0,
  origem          text,
  campanha        text,
  atualizado_em   timestamptz not null default now()
);
create index if not exists crm_negocios_criado_idx  on crm_negocios (cliente_id, criado_em);
create index if not exists crm_negocios_fechado_idx on crm_negocios (cliente_id, fechado_em);

-- 0006: CRM com todos os funis, fontes de anúncio e campos dos negócios
alter table crm_conexoes add column if not exists fontes_anuncio text[];
alter table crm_negocios add column if not exists pipeline_nome text;
alter table crm_negocios add column if not exists responsavel   text;
alter table crm_negocios add column if not exists campos        jsonb;

-- Segurança: só o servidor (chave secreta) acessa as tabelas.
alter table clientes          enable row level security;
alter table tokens_meta       enable row level security;
alter table contas_anuncio    enable row level security;
alter table metricas_diarias  enable row level security;
alter table sync_execucoes    enable row level security;
alter table status_meta       enable row level security;
alter table crm_conexoes      enable row level security;
alter table crm_negocios      enable row level security;
