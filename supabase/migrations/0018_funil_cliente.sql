-- 0018: Funil do relatório montado por cliente (passos com as etapas do CRM que contam em cada um).
-- {"soAnuncio": true, "leads": "Leads", "vendas": "Vendas", "passos": [{"nome": "Interessados", "etapas": ["id1"]}, …]}
alter table crm_conexoes    add column if not exists funil  jsonb;
-- Valores de cada passo no mês: [{"nome": "Interessados", "valor": 8}, {"nome": "Propostas", "valor": 6}]
alter table historico_mensal add column if not exists passos jsonb;
