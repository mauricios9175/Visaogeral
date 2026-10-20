import "server-only";
import { db } from "../db";
import { diasAtras, hojeISO } from "../datas";
import { camposDoNegocio, campanhaDoNegocio, idNegocio, listarFunis, listarNegocios, type FunilRd } from "./rd";
import { camposDaOportunidade, listarFunisHL, listarOportunidades, nomesCamposHL } from "./highlevel";

export type TipoCrm = "rd_crm" | "highlevel" | "kommo";

export const NOME_CRM: Record<TipoCrm, string> = {
  rd_crm: "RD Station CRM",
  highlevel: "Ávora (HighLevel)",
  kommo: "Kommo",
};

export type ConexaoCrm = {
  cliente_id: string;
  tipo: TipoCrm;
  token: string;
  subdominio: string | null;
  location_id: string | null;   // HighLevel/Ávora: ID da subconta
  pipeline_id: string | null;
  pipeline_nome: string | null;
  etapa_qualificado: string | null;
  etapa_qualificado_nome: string | null;
  etapa_qualificado_ordem: number | null;
  fontes_anuncio: string[] | null;
  ultima_sync: string | null;
  ultimo_erro: string | null;
};

/** Negócio no formato comum do painel, venha de qual CRM vier. */
type NegocioNormalizado = {
  idExterno: string;
  nome: string | null;
  criado_em: string;
  fechado_em: string | null;
  etapa_id: string | null;
  etapa_nome: string | null;
  pipeline_id_api: string | null;
  ganho: boolean | null;
  valor: number;
  origem: string | null;
  campanha: string | null;
  responsavel: string | null;
  campos: Record<string, string> | null;
};

/** Funis e etapas do CRM da conexão (também serve para testar a conexão). */
export function listarFunisCrm(c: Pick<ConexaoCrm, "tipo" | "token" | "location_id">): Promise<FunilRd[]> {
  if (c.tipo === "rd_crm") return listarFunis(c.token);
  if (c.tipo === "highlevel") {
    if (!c.location_id) throw new Error("Informe o ID da subconta do Ávora.");
    return listarFunisHL(c.token, c.location_id);
  }
  throw new Error(`${NOME_CRM[c.tipo]} ainda não está disponível.`);
}

async function buscarNegocios(c: ConexaoCrm, dias: number): Promise<NegocioNormalizado[]> {
  if (c.tipo === "rd_crm") {
    const negocios = await listarNegocios(c.token, diasAtras(dias), hojeISO(), null);
    return negocios.map((d) => ({
      idExterno: idNegocio(d),
      nome: d.name ?? null,
      criado_em: d.created_at,
      fechado_em: d.closed_at ?? null,
      etapa_id: idNegocio(d.deal_stage) || null,
      etapa_nome: d.deal_stage?.name ?? null,
      pipeline_id_api: idNegocio(d.deal_pipeline) || null,
      ganho: d.win ?? null,
      valor: Number(d.amount_total ?? 0) || 0,
      origem: d.deal_source?.name ?? null,
      campanha: campanhaDoNegocio(d),
      responsavel: d.user?.name ?? null,
      campos: camposDoNegocio(d),
    }));
  }
  if (c.tipo === "highlevel" && c.location_id) {
    const [ops, nomes] = await Promise.all([
      listarOportunidades(c.token, c.location_id, diasAtras(dias)),
      nomesCamposHL(c.token, c.location_id),
    ]);
    return ops.map((o) => ({
      idExterno: o.id,
      nome: o.name ?? o.contact?.name ?? null,
      criado_em: o.createdAt,
      fechado_em: o.status === "won" || o.status === "lost" || o.status === "abandoned" ? o.lastStatusChangeAt ?? o.updatedAt ?? null : null,
      etapa_id: o.pipelineStageId ?? null,
      etapa_nome: null,
      pipeline_id_api: o.pipelineId ?? null,
      ganho: o.status === "won" ? true : o.status === "lost" || o.status === "abandoned" ? false : null,
      valor: Number(o.monetaryValue ?? 0) || 0,
      origem: o.source || o.contact?.source || null,
      campanha: null,
      responsavel: null,
      campos: camposDaOportunidade(o, nomes),
    }));
  }
  throw new Error(`${NOME_CRM[c.tipo]} ainda não está disponível.`);
}

/** Traz os negócios de um cliente criados ou fechados nos últimos `dias` dias. */
export async function sincronizarCrmCliente(c: ConexaoCrm, dias: number) {
  const banco = db();
  try {
    const funis = await listarFunisCrm(c);
    // etapa → funil, nome e ordem (o negócio nem sempre informa o funil diretamente)
    const etapas = new Map(
      funis.flatMap((f) => f.etapas.map((e) => [e.id, { ordem: e.ordem, nome: e.nome, funilId: f.id, funilNome: f.nome }] as const)),
    );
    // Sempre todos os funis: leads entram por um funil (ex.: SDR) e podem passar para outro (consultores).
    const negocios = await buscarNegocios(c, dias);
    const agora = new Date().toISOString();
    const linhas = negocios.map((n) => {
      const e = n.etapa_id ? etapas.get(n.etapa_id) : undefined;
      return {
        id: `${c.tipo}:${n.idExterno}`,
        cliente_id: c.cliente_id,
        pipeline_id: e?.funilId ?? n.pipeline_id_api,
        pipeline_nome: e?.funilNome ?? null,
        nome: n.nome,
        criado_em: n.criado_em,
        fechado_em: n.fechado_em,
        etapa_id: n.etapa_id,
        etapa_nome: n.etapa_nome ?? e?.nome ?? null,
        etapa_ordem: e?.ordem ?? null,
        ganho: n.ganho,
        valor: n.valor,
        origem: n.origem,
        campanha: n.campanha,
        responsavel: n.responsavel,
        campos: n.campos,
        atualizado_em: agora,
      };
    });
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
