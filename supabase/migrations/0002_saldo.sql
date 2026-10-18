-- Saldo e limite de gastos das contas, atualizados a cada sincronização.
alter table contas_anuncio
  add column pre_paga        boolean,
  add column saldo           numeric(14,2),  -- saldo disponível (contas pré-pagas)
  add column saldo_texto     text,           -- texto original do Meta, ex.: "Saldo disponível (R$ 120,00 BRL)"
  add column limite_gasto    numeric(14,2),  -- limite de gastos da conta (spend_cap), se houver
  add column total_gasto     numeric(14,2),  -- gasto acumulado da conta (amount_spent)
  add column saldo_em        timestamptz;
