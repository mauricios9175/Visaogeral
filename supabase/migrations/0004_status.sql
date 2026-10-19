-- Status atual (effective_status do Meta) de campanhas, conjuntos e anúncios.
create table status_meta (
  id             text primary key,         -- id da campanha, conjunto ou anúncio
  conta_id       text not null references contas_anuncio(id) on delete cascade,
  nivel          text not null check (nivel in ('campanha', 'conjunto', 'anuncio')),
  status         text not null,            -- ACTIVE, PAUSED, CAMPAIGN_PAUSED, ADSET_PAUSED, DISAPPROVED...
  atualizado_em  timestamptz not null default now()
);
create index on status_meta (conta_id);
alter table status_meta enable row level security;
