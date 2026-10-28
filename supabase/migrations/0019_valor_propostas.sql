-- 0019: Valor das propostas no histórico: soma do valor de todas as oportunidades do funil do cliente no mês.
alter table historico_mensal add column if not exists valor_propostas numeric(14,2);
