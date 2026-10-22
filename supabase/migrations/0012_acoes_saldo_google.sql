-- 0012: Ações rápidas (pausar/ativar/orçamento) com histórico, e saldo do Google pelas recargas.

-- Orçamento atual de campanhas e conjuntos do Meta (preenchido na sincronização)
alter table status_meta add column if not exists orcamento_diario numeric(14,2);
alter table status_meta add column if not exists orcamento_total  numeric(14,2);

-- Orçamento diário das campanhas do Google (na linha do dia)
alter table metricas_google add column if not exists orcamento_diario        numeric(14,2);
alter table metricas_google add column if not exists orcamento_compartilhado boolean;

-- Tudo o que foi feito pelo painel: vira o histórico de otimizações
create table if not exists acoes_log (
  id           bigint generated always as identity primary key,
  criado_em    timestamptz not null default now(),
  plataforma   text not null check (plataforma in ('meta', 'google')),
  cliente_id   uuid references clientes(id) on delete set null,
  conta_id     text,
  nivel        text,          -- campanha, conjunto, anuncio
  objeto_id    text not null,
  objeto_nome  text,
  acao         text not null, -- pausar, ativar, orcamento
  antes        text,
  depois       text,
  ok           boolean not null,
  erro         text
);
create index if not exists acoes_log_cliente_idx on acoes_log (cliente_id, criado_em desc);

-- Google pré-pago: a API não informa o saldo, então ele é calculado pelas recargas registradas
create table if not exists recargas_google (
  id         bigint generated always as identity primary key,
  conta_id   text not null references contas_google(id) on delete cascade,
  data       date not null,
  valor      numeric(14,2) not null,
  tipo       text not null default 'recarga' check (tipo in ('recarga', 'saldo')), -- saldo = "o saldo era X nesta data"
  criado_em  timestamptz not null default now()
);
create index if not exists recargas_google_conta_idx on recargas_google (conta_id, data);

-- Orçamento da conta do Google (limite de gastos), quando configurado
alter table contas_google add column if not exists limite_conta  numeric(14,2);
alter table contas_google add column if not exists gasto_limite  numeric(14,2);

alter table acoes_log       enable row level security;
alter table recargas_google enable row level security;
