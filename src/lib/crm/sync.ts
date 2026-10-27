import "server-only";
import { db } from "../db";
import { diasAtras, hojeISO } from "../datas";
import { camposDoNegocio, campanhaDoNegocio, idNegocio, listarFunis, listarNegocios, utmsDoNegocioRd, type FunilRd } from "./rd";
import {
  atribuicaoDoContato, atribuicoesDaOportunidade, camposDaOportunidade, listarFunisHL, listarOportunidades, nomesCamposHL,
  SemPermissaoContatos, utmsDe, type Atribuicao, type Utms,
} from "./highlevel";

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
  utms: Utms | null;
  // v: versão da leitura do contato (2 = já inclui os campos personalizados do contato)
  atribuicao: { primeiro: Atribuicao | null; ultimo: Atribuicao | null; v?: number } | null;
  contatoId: string | null;
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
      utms: utmsDoNegocioRd(d),
      atribuicao: null,
      contatoId: null,
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
      ...(() => {
        const atrib = atribuicoesDaOportunidade(o);
        return { atribuicao: atrib, utms: utmsDe(atrib?.primeiro) ?? utmsDe(atrib?.ultimo) };
      })(),
      contatoId: o.contactId ?? o.contact?.id ?? null,
    }));
  }
  throw new Error(`${NOME_CRM[c.tipo]} ainda não está disponível.`);
}

/** Avisos da última sincronização por cliente (ex.: token sem permissão de contatos). */
export const avisosUtm = new Map<string, string>();

let temColunasUtm: boolean | null = null;
async function colunasUtm() {
  if (temColunasUtm === null) {
    const { error } = await db().from("crm_negocios").select("utm_source").limit(1);
    temColunasUtm = !error;
  }
  return temColunasUtm;
}

// Limite de contatos consultados por sincronização (o HighLevel aceita ~100 chamadas a cada 10 s).
const MAX_CONTATOS_POR_SYNC = 300;

/**
 * HighLevel/Ávora: quando a oportunidade não traz a atribuição, lê do contato (primeiro e último acesso).
 * Contatos já consultados antes não são consultados de novo: reaproveita o que está no banco.
 * Devolve um aviso (ex.: token sem permissão de contatos) ou null.
 */
async function completarUtmsPeloContato(c: ConexaoCrm, negocios: NegocioNormalizado[], maxContatos = MAX_CONTATOS_POR_SYNC): Promise<string | null> {
  type Salvo = { id: string; campos: Record<string, string> | null; atribuicao: NegocioNormalizado["atribuicao"] } & Record<`utm_${"source" | "medium" | "campaign" | "content" | "term"}`, string | null>;
  const ids = negocios.map((n) => `${c.tipo}:${n.idExterno}`);
  const salvos = new Map<string, Salvo>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await db().from("crm_negocios")
      .select("id, campos, utm_source, utm_medium, utm_campaign, utm_content, utm_term, atribuicao")
      .in("id", ids.slice(i, i + 300)).eq("utm_buscada", true);
    if (error) return null; // SQL 0011 não rodou: segue sem UTMs do contato
    for (const r of (data ?? []) as Salvo[]) salvos.set(r.id, r);
  }
  const faltando: NegocioNormalizado[] = [];
  for (const n of negocios) {
    if (n.utms?.campaign || n.utms?.content) continue; // a oportunidade já trouxe a UTM
    const s = salvos.get(`${c.tipo}:${n.idExterno}`);
    if (s && s.atribuicao?.v === 2) {
      // contato já lido antes: reaproveita a atribuição e os campos do contato guardados
      n.atribuicao = s.atribuicao;
      n.utms = { source: s.utm_source, medium: s.utm_medium, campaign: s.utm_campaign, content: s.utm_content, term: s.utm_term };
      if (!Object.values(n.utms).some(Boolean)) n.utms = null;
      n.campos = { ...(s.campos ?? {}), ...(n.campos ?? {}) };
    } else if (n.contatoId) {
      faltando.push(n);
    }
  }
  if (!faltando.length || maxContatos <= 0) return null;
  // mais recentes primeiro; o resto fica para as próximas sincronizações
  faltando.sort((a, b) => b.criado_em.localeCompare(a.criado_em));
  const fila = faltando.slice(0, maxContatos);
  const nomesContato = await nomesCamposHL(c.token, c.location_id ?? "", "contact");
  const cache = new Map<string, Awaited<ReturnType<typeof atribuicaoDoContato>>>();
  let aviso: string | null = null;
  async function trabalhador() {
    for (let n = fila.shift(); n && !aviso; n = fila.shift()) {
      try {
        if (!cache.has(n.contatoId!)) cache.set(n.contatoId!, await atribuicaoDoContato(c.token, n.contatoId!));
        const contato = cache.get(n.contatoId!) ?? null;
        n.atribuicao = { primeiro: contato?.primeiro ?? null, ultimo: contato?.ultimo ?? null, v: 2 };
        n.utms = n.utms ?? utmsDe(contato?.primeiro) ?? utmsDe(contato?.ultimo);
        // campos do contato entram junto com os da oportunidade (os da oportunidade têm prioridade)
        const doContato = camposDaOportunidade({ customFields: contato?.campos ?? [] }, nomesContato);
        if (doContato) n.campos = { ...doContato, ...(n.campos ?? {}) };
      } catch (e) {
        if (e instanceof SemPermissaoContatos) aviso = "o token do Ávora não tem permissão para ler contatos (escopo contacts.readonly)";
        // outros erros: tenta de novo na próxima sincronização
      }
    }
  }
  await Promise.all([trabalhador(), trabalhador(), trabalhador(), trabalhador()]);
  return aviso;
}

/** Traz os negócios de um cliente criados ou fechados nos últimos `dias` dias. */
/** `maxContatos`: quantos contatos consultar para completar as UTMs (0 = só reaproveita o que já está no banco). */
export async function sincronizarCrmCliente(c: ConexaoCrm, dias: number, maxContatos = MAX_CONTATOS_POR_SYNC) {
  const banco = db();
  try {
    const funis = await listarFunisCrm(c);
    // etapa → funil, nome e ordem (o negócio nem sempre informa o funil diretamente)
    const etapas = new Map(
      funis.flatMap((f) => f.etapas.map((e) => [e.id, { ordem: e.ordem, nome: e.nome, funilId: f.id, funilNome: f.nome }] as const)),
    );
    // Sempre todos os funis: leads entram por um funil (ex.: SDR) e podem passar para outro (consultores).
    const negocios = await buscarNegocios(c, dias);
    const avisoUtm = c.tipo === "highlevel" && (await colunasUtm()) ? await completarUtmsPeloContato(c, negocios, maxContatos) : null;
    const agora = new Date().toISOString();
    // sem o SQL 0011 as colunas de UTM não existem: salva o resto normalmente
    const comUtm = await colunasUtm();
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
        ...(comUtm && {
          utm_source: n.utms?.source ?? null,
          utm_medium: n.utms?.medium ?? null,
          utm_campaign: n.utms?.campaign ?? null,
          utm_content: n.utms?.content ?? null,
          utm_term: n.utms?.term ?? null,
          atribuicao: n.atribuicao,
          // RD: não há o que buscar no contato; HighLevel: marcado quando a atribuição já foi lida
          utm_buscada: c.tipo !== "highlevel" || !!n.atribuicao || n.utms != null,
        }),
        atualizado_em: agora,
      };
    });
    for (let i = 0; i < linhas.length; i += 500) {
      const { error } = await banco.from("crm_negocios").upsert(linhas.slice(i, i + 500), { onConflict: "id" });
      if (error) throw new Error(error.message);
    }
    await banco.from("crm_conexoes").update({ ultima_sync: agora, ultimo_erro: null }).eq("cliente_id", c.cliente_id);
    if (avisoUtm) avisosUtm.set(c.cliente_id, avisoUtm);
    else avisosUtm.delete(c.cliente_id);
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
  const { data: conexoes } = await banco.from("crm_conexoes")
    .select("*, clientes!inner(nome, ativo)").eq("clientes.ativo", true);
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
