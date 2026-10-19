-- Fase 2: CRM dos clientes (começando pelo RD Station CRM).

-- Uma conexão de CRM por cliente.
create table crm_conexoes (
  cliente_id          uuid primary key references clientes(id) on delete cascade,
  tipo                text not null check (tipo in ('rd_crm', 'kommo')),
  token               text not null,
  subdominio          text,                 -- só Kommo
  pipeline_id         text,                 -- funil usado (null = todos)
  pipeline_nome       text,
  etapa_qualificado   text,                 -- id da etapa a partir da qual o lead conta como qualificado
  etapa_qualificado_nome text,
  etapa_qualificado_ordem int,
  ultima_sync         timestamptz,
  ultimo_erro         text,
  criado_em           timestamptz not null default now()
);

-- Negócios (deals) trazidos do CRM.
create table crm_negocios (
  id              text primary key,         -- "<tipo>:<id no CRM>"
  cliente_id      uuid not null references clientes(id) on delete cascade,
  pipeline_id     text,
  nome            text,
  criado_em       timestamptz not null,
  fechado_em      timestamptz,
  etapa_id        text,
  etapa_nome      text,
  etapa_ordem     int,
  ganho           boolean,                  -- true = venda, false = perdido, null = em aberto
  valor           numeric(14,2) not null default 0,
  origem          text,                     -- fonte do negócio no CRM
  campanha        text,                     -- campanha/UTM, quando houver
  atualizado_em   timestamptz not null default now()
);
create index on crm_negocios (cliente_id, criado_em);
create index on crm_negocios (cliente_id, fechado_em);

alter table crm_conexoes enable row level security;
alter table crm_negocios enable row level security;
