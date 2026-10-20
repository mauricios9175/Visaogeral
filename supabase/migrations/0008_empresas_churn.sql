-- Empresas (agências parceiras / clientes próprios) e churn de clientes.
alter table clientes add column if not exists empresa  text;
alter table clientes add column if not exists churn_em date;

-- Preenche a empresa a partir do que estava escrito no nicho.
update clientes set empresa = case
    when nicho ilike 'propuls%' then 'Propulsão'
    when nicho ilike 'vic%'     then 'Viccon'
    else 'Clientes próprios'
  end
where empresa is null;

-- Limpa o nicho que só repetia a empresa ("Propulsão - Planejados" → "Planejados"; "Viccon" → vazio).
update clientes set nicho = nullif(trim(substring(nicho from position('-' in nicho) + 1)), '')
where nicho ilike 'propuls%-%';
update clientes set nicho = null where nicho ilike 'viccon' or nicho ilike 'vicon';

-- Clientes já desativados contam como churn a partir de hoje.
update clientes set churn_em = current_date where ativo = false and churn_em is null;
