-- CRM: suporte ao HighLevel (Ávora e outras versões com marca própria).
alter table crm_conexoes drop constraint if exists crm_conexoes_tipo_check;
alter table crm_conexoes add constraint crm_conexoes_tipo_check check (tipo in ('rd_crm', 'highlevel', 'kommo'));
alter table crm_conexoes add column if not exists location_id text;   -- ID da subconta no HighLevel
