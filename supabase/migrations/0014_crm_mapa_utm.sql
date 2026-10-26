-- 0014: Qual campo do CRM corresponde a cada UTM (cada cliente nomeia de um jeito: "Campanha", "Criativo", "Público"…).
alter table crm_conexoes add column if not exists mapa_utm jsonb;  -- {"campaign": "Campanha", "content": "Criativo", …}
