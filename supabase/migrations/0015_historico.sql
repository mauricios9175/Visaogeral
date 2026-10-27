-- 0015: Histórico mensal de cada cliente (o que antes ficava na planilha) e etapa de propostas no CRM.
-- Cada mês é gravado uma vez e fica salvo: o painel só recalcula o mês atual e o anterior.

create table if not exists historico_mensal (
  cliente_id         uuid not null references clientes(id) on delete cascade,
  mes                date not null,                     -- 1º dia do mês
  gasto_meta         numeric(14,2) not null default 0,
  gasto_google       numeric(14,2) not null default 0,
  resultados_meta    numeric(12,2) not null default 0,  -- resultados das plataformas (leads, conversas…)
  resultados_google  numeric(12,2) not null default 0,
  crm                boolean not null default false,    -- os números abaixo vieram do CRM?
  leads              integer,
  interessados       integer,
  propostas          integer,
  vendas             integer,
  faturamento        numeric(14,2),
  ajustes            jsonb,                             -- valores corrigidos à mão: {"leads": 98, "vendas": 3}
  observacao         text,
  atualizado_em      timestamptz not null default now(),
  primary key (cliente_id, mes)
);
alter table historico_mensal enable row level security;

-- Segunda etapa do funil (Propostas, Projetos, Agendamentos…) e como cada cliente chama as etapas
alter table crm_conexoes add column if not exists etapa_proposta        text;
alter table crm_conexoes add column if not exists etapa_proposta_nome   text;
alter table crm_conexoes add column if not exists etapa_proposta_ordem  int;
alter table crm_conexoes add column if not exists pipeline_proposta_id  text;
alter table crm_conexoes add column if not exists rotulos               jsonb;  -- {"interessados": "Qualificados", "propostas": "Projetos"}
