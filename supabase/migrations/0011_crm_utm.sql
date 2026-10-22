-- 0011: UTMs dos negócios do CRM (primeiro toque do lead), para saber de onde vêm leads e vendas.
alter table crm_negocios add column if not exists utm_source   text;
alter table crm_negocios add column if not exists utm_medium   text;
alter table crm_negocios add column if not exists utm_campaign text;
alter table crm_negocios add column if not exists utm_content  text;
alter table crm_negocios add column if not exists utm_term     text;
alter table crm_negocios add column if not exists atribuicao   jsonb;   -- dados brutos: {"primeiro": {...}, "ultimo": {...}}
alter table crm_negocios add column if not exists utm_buscada  boolean not null default false; -- já consultou o contato no CRM
