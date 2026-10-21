-- 0009: Google Ads (login com Google, contas diretas e de MCC, métricas diárias por campanha).

-- Logins com Google (refresh token do OAuth). Um por e-mail.
create table if not exists tokens_google (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  refresh_token text not null,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Contas de anúncio do Google Ads (id = customer id só com dígitos, ex.: 1234567890).
create table if not exists contas_google (
  id                text primary key,
  cliente_id        uuid references clientes(id) on delete set null,
  nome              text not null,
  moeda             text,
  fuso              text,
  status            text,          -- ENABLED, SUSPENDED, CANCELED…
  login_customer_id text,          -- MCC usado para acessar (ou a própria conta, se o acesso é direto)
  gerente_nome      text,          -- nome do MCC (ex.: agência) ou "Acesso direto"
  token_id          uuid references tokens_google(id) on delete set null,
  ativa_sync        boolean not null default true,
  ultima_sync       timestamptz,
  ultimo_erro       text,
  criado_em         timestamptz not null default now()
);
create index if not exists contas_google_cliente_idx on contas_google (cliente_id);

-- Métricas diárias por campanha.
create table if not exists metricas_google (
  conta_id          text not null references contas_google(id) on delete cascade,
  data              date not null,
  campaign_id       text not null,
  campaign_nome     text,
  campaign_status   text,          -- ENABLED, PAUSED, REMOVED
  canal             text,          -- SEARCH, PERFORMANCE_MAX, DISPLAY, VIDEO…
  gasto             numeric(14,2) not null default 0,
  impressoes        bigint not null default 0,
  cliques           bigint not null default 0,
  conversoes        numeric(14,2) not null default 0,
  valor_conversoes  numeric(14,2) not null default 0,
  conversoes_acao   jsonb,         -- {"Clique no WhatsApp": 3, "Formulário": 2}
  atualizado_em     timestamptz not null default now(),
  primary key (conta_id, data, campaign_id)
);
create index if not exists metricas_google_data_idx on metricas_google (data);

alter table tokens_google   enable row level security;
alter table contas_google   enable row level security;
alter table metricas_google enable row level security;
