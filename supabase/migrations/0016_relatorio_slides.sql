-- 0016: Relatório no Google Slides (modelo da Propulsão copiado e preenchido pelo painel).

-- Configurações gerais do painel (ex.: qual apresentação do Drive é o modelo do relatório)
create table if not exists configuracoes (
  chave          text primary key,
  valor          jsonb not null,
  atualizado_em  timestamptz not null default now()
);

-- Relatórios gerados (para achar de novo o link)
create table if not exists relatorios_gerados (
  id          bigint generated always as identity primary key,
  cliente_id  uuid references clientes(id) on delete cascade,
  periodo     text,
  link        text not null,
  criado_em   timestamptz not null default now()
);
create index if not exists relatorios_gerados_cliente_idx on relatorios_gerados (cliente_id, criado_em desc);

alter table configuracoes      enable row level security;
alter table relatorios_gerados enable row level security;
