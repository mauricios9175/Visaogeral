import "server-only";
import { db } from "../db";
import { diasAtras, hojeISO } from "../datas";
import { camposDoNegocio, campanhaDoNegocio, idNegocio, listarFunis, listarNegocios } from "./rd";

export type ConexaoCrm = {
  cliente_id: string;
  tipo: "rd_crm" | "kommo";
  token: string;
  subdominio: string | null;
  pipeline_id: string | null;
  pipeline_nome: string | null;
  etapa_qualificado: string | null;
  etapa_qualificado_nome: string | null;
  etapa_qualificado_ordem: number | null;
  fontes_anuncio: string[] | null;
  ultima_sync: string | null;
  ultimo_erro: string | null;
};

/** Traz os negócios de um cliente criados ou fechados nos últimos `dias` dias. */
export async function sincronizarCrmCliente(c: ConexaoCrm, dias: number) {
  const banco = db();
  try {
    if (c.tipo !== "rd_crm") throw new Error("Por enquanto só o RD Station CRM está disponível.");
    const funis = await listarFunis(c.token);
    // etapa → funil e ordem (o negócio nem sempre informa o funil diretamente)
    const etapas = new Map(
      funis.flatMap((f) => f.etapas.map((e) => [e.id, { ordem: e.ordem, funilId: f.id, funilNome: f.nome }] as const)),
    );
    // Sempre todos os funis: leads entram por um funil (ex.: SDR) e podem passar para outro (consultores).
    const negocios = await listarNegocios(c.token, diasAtras(dias), hojeISO(), null);
    const agora = new Date().toISOString();
    const linhas = negocios.map((d) => ({
      id: `rd_crm:${idNegocio(d)}`,
      cliente_id: c.cliente_id,
      pipeline_id: etapas.get(idNegocio(d.deal_stage))?.funilId ?? (idNegocio(d.deal_pipeline) || null),
      pipeline_nome: etapas.get(idNegocio(d.deal_stage))?.funilNome ?? null,
      responsavel: d.user?.name ?? null,
      campos: camposDoNegocio(d),
      nome: d.name ?? null,
      criado_em: d.created_at,
      fechado_em: d.closed_at ?? null,
      etapa_id: idNegocio(d.deal_stage) || null,
      etapa_nome: d.deal_stage?.name ?? null,
      etapa_ordem: etapas.get(idNegocio(d.deal_stage))?.ordem ?? null,
      ganho: d.win ?? null,
      valor: Number(d.amount_total ?? 0) || 0,
      origem: d.deal_source?.name ?? null,
      campanha: campanhaDoNegocio(d),
      atualizado_em: agora,
    }));
    for (let i = 0; i < linhas.length; i += 500) {
      const { error } = await banco.from("crm_negocios").upsert(linhas.slice(i, i + 500), { onConflict: "id" });
      if (error) throw new Error(error.message);
    }
    await banco.from("crm_conexoes").update({ ultima_sync: agora, ultimo_erro: null }).eq("cliente_id", c.cliente_id);
    return linhas.length;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await banco.from("crm_conexoes").update({ ultimo_erro: msg }).eq("cliente_id", c.cliente_id);
    throw new Error(msg);
  }
}

/** Sincroniza o CRM de todos os clientes conectados. Devolve os erros por cliente. */
export async function sincronizarCrms(dias: number) {
  const banco = db();
  const { data: conexoes } = await banco.from("crm_conexoes").select("*, clientes(nome)");
  const erros: string[] = [];
  let negocios = 0;
  for (const c of (conexoes ?? []) as (ConexaoCrm & { clientes: { nome: string } | null })[]) {
    try {
      negocios += await sincronizarCrmCliente(c, dias);
    } catch (e) {
      erros.push(`CRM ${c.clientes?.nome ?? c.cliente_id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { negocios, erros };
}
