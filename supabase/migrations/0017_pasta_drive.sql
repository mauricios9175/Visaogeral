-- 0017: Pasta do Google Drive de cada cliente, onde os relatórios são salvos ({"id": "...", "nome": "Relatórios Midas"}).
alter table clientes add column if not exists pasta_drive jsonb;
