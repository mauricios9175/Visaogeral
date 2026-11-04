-- 0021: Notificações no celular (push): aparelhos inscritos e avisos já enviados (para não repetir).
create table if not exists push_inscricoes (
  endpoint   text primary key,
  chaves     jsonb not null,          -- {p256dh, auth} da inscrição do navegador
  aparelho   text,
  criado_em  timestamptz not null default now()
);
create table if not exists push_enviados (
  chave       text primary key,       -- alerta + dia: o mesmo alerta não é enviado de novo no mesmo dia
  enviado_em  timestamptz not null default now()
);
alter table push_inscricoes enable row level security;
alter table push_enviados   enable row level security;
