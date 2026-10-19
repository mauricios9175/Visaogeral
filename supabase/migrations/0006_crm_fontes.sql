-- CRM: todos os funis, fontes de anúncio e campos dos negócios.
alter table crm_conexoes add column if not exists fontes_anuncio text[];   -- null = detectar automaticamente
alter table crm_negocios add column if not exists pipeline_nome text;
alter table crm_negocios add column if not exists responsavel   text;
alter table crm_negocios add column if not exists campos        jsonb;    -- campos personalizados {rótulo: valor}
