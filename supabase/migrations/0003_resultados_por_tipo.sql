-- "Resultado" de cada anúncio/dia como o Gerenciador de Anúncios mostra, separado por tipo.
alter table metricas_diarias
  add column resultados      numeric(14,2) not null default 0,
  add column resultado_tipo  text,   -- conversas | formulario | lead_site | conv_personalizada | compras | cadastro | outros
  add column resultado_acao  text;   -- action_type original do Meta, ex.: offsite_conversion.custom.123

drop view if exists vw_cliente_dia;

-- Linhas antigas (antes desta migração) não têm tipo: contam conversas e leads como antes.
create view vw_cliente_dia as
select
  c.cliente_id,
  m.data,
  sum(m.gasto)          as gasto,
  sum(m.impressoes)     as impressoes,
  sum(m.alcance)        as alcance,
  sum(m.cliques)        as cliques,
  sum(m.cliques_link)   as cliques_link,
  sum(m.leads)          as leads,
  sum(m.conversas)      as conversas,
  sum(m.compras)        as compras,
  sum(m.valor_compras)  as valor_compras,
  sum(case when m.resultado_tipo = 'conversas' then m.resultados
           when m.resultado_tipo is null then m.conversas else 0 end)           as res_conversas,
  sum(case when m.resultado_tipo = 'formulario' then m.resultados else 0 end)    as res_formulario,
  sum(case when m.resultado_tipo = 'lead_site' then m.resultados
           when m.resultado_tipo is null then m.leads else 0 end)               as res_lead_site,
  sum(case when m.resultado_tipo = 'conv_personalizada' then m.resultados else 0 end) as res_conv_personalizada,
  sum(case when m.resultado_tipo = 'compras' then m.resultados else 0 end)       as res_compras,
  sum(case when m.resultado_tipo = 'cadastro' then m.resultados else 0 end)      as res_cadastro,
  sum(case when m.resultado_tipo = 'outros' then m.resultados else 0 end)        as res_outros
from metricas_diarias m
join contas_anuncio c on c.id = m.conta_id
where c.cliente_id is not null
group by c.cliente_id, m.data;
