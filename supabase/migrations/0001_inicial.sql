-- Fase 1: clientes, contas do Meta, tokens e métricas diárias por anúncio.
-- Rode este arquivo no SQL Editor do Supabase (ou via `supabase db push`).

create extension if not exists pgcrypto;

create table clientes (
  id                uuid primary key default gen_random_uuid(),
  nome              text not null,
  nicho             text,
  cpl_meta          numeric(12,2),   -- custo por resultado alvo
  orcamento_mensal  numeric(12,2),
  roas_meta         numeric(8,2),
  ativo             boolean not null default true,
  criado_em         timestamptz not null default now()
);

-- Tokens de usuário obtidos via "Login com Facebook" (contas que ficam no BM do cliente).
-- O token do Usuário do Sistema do seu BM fica na variável META_SYSTEM_USER_TOKEN.
create table tokens_meta (
  id           uuid primary key default gen_random_uuid(),
  fb_user_id   text not null unique,
  nome         text,
  token        text not null,
  expira_em    timestamptz,
  criado_em    timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table contas_anuncio (
  id            text primary key,              -- ex.: act_1234567890
  cliente_id    uuid references clientes(id) on delete set null,
  nome          text not null,
  moeda         text,
  fuso          text,
  status        int,                           -- account_status do Meta (1 = ativa)
  bm_nome       text,
  origem        text not null check (origem in ('bm', 'usuario')),
  token_id      uuid references tokens_meta(id) on delete set null,
  ativa_sync    boolean not null default true,
  ultima_sync   timestamptz,
  ultimo_erro   text,
  criado_em     timestamptz not null default now()
);
create index on contas_anuncio (cliente_id);

create table metricas_diarias (
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
  leads           int not null default 0,   -- formulário nativo + pixel
  conversas       int not null default 0,   -- conversas iniciadas (WhatsApp/Direct/Messenger)
  compras         int not null default 0,
  valor_compras   numeric(14,2) not null default 0,
  atualizado_em   timestamptz not null default now(),
  primary key (conta_id, data, ad_id)
);
create index on metricas_diarias (data);
create index on metricas_diarias (conta_id, campaign_id);

create table sync_execucoes (
  id            bigint generated always as identity primary key,
  modo          text not null,
  iniciado_em   timestamptz not null default now(),
  finalizado_em timestamptz,
  status        text not null default 'rodando',
  contas        int default 0,
  linhas        int default 0,
  erros         text
);

-- Soma por cliente e dia, usada pela visão geral e pela tela do cliente.
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
  sum(m.valor_compras)  as valor_compras
from metricas_diarias m
join contas_anuncio c on c.id = m.conta_id
where c.cliente_id is not null
group by c.cliente_id, m.data;

-- Só o servidor (chave service_role) acessa as tabelas. Nada fica exposto pela chave pública.
alter table clientes          enable row level security;
alter table tokens_meta       enable row level security;
alter table contas_anuncio    enable row level security;
alter table metricas_diarias  enable row level security;
alter table sync_execucoes    enable row level security;
