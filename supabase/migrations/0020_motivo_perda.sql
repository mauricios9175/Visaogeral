-- 0020: Motivo de perda de cada negócio do CRM (Ávora: motivo de perda da oportunidade; RD: motivo de perda).
alter table crm_negocios add column if not exists motivo_perda text;
