-- 0010: Painel de criativos (métricas de vídeo por anúncio/dia e dados do criativo).

alter table metricas_diarias add column if not exists video_plays    bigint not null default 0;
alter table metricas_diarias add column if not exists video_3s       bigint not null default 0; -- reproduções de 3 segundos (gancho)
alter table metricas_diarias add column if not exists video_p25      bigint not null default 0;
alter table metricas_diarias add column if not exists video_p50      bigint not null default 0;
alter table metricas_diarias add column if not exists video_p75      bigint not null default 0;
alter table metricas_diarias add column if not exists video_p100     bigint not null default 0;
alter table metricas_diarias add column if not exists video_thruplay bigint not null default 0;

-- Um registro por anúncio: miniatura, tipo e link do post. Atualizado a cada sincronização.
create table if not exists criativos_meta (
  ad_id          text primary key,
  conta_id       text not null references contas_anuncio(id) on delete cascade,
  tipo           text,   -- VIDEO, PHOTO, SHARE (carrossel/link), STATUS…
  thumbnail_url  text,
  imagem_url     text,
  video_id       text,
  titulo         text,
  texto          text,
  link           text,   -- post no Instagram ou Facebook
  atualizado_em  timestamptz not null default now()
);
create index if not exists criativos_meta_conta_idx on criativos_meta (conta_id);

alter table criativos_meta enable row level security;
