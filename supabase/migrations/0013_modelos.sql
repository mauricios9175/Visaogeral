-- 0013: Modelos de campanha (montar campanha, conjunto e anúncios a partir de um modelo pronto).

create table if not exists modelos (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,
  plataforma     text not null default 'meta' check (plataforma in ('meta', 'google')),
  objetivo       text not null,          -- meta: formulario, mensagens, site · google: pesquisa
  config         jsonb not null default '{}'::jsonb,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

-- Últimas escolhas de cada cliente (página, Instagram, formulário, pixel, cidades), para já vir preenchido
alter table clientes add column if not exists padroes_meta jsonb;

alter table modelos enable row level security;
