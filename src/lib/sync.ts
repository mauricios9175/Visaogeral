import "server-only";
import { db, type ContaAnuncio, type TokenMeta } from "./db";
import { dadosFinanceiros, extrairResultados, insightsPorAnuncio, listarContas, MetaErro, type LinhaInsight } from "./meta";
import { diasAtras, diasEntre, hojeISO, somarDias } from "./datas";

/** Busca no Meta todas as contas que os tokens enxergam e cadastra/atualiza no banco. */
export async function importarContas() {
  const banco = db();
  const encontradas = new Map<string, Partial<ContaAnuncio>>();

  const { data: tokens } = await banco.from("tokens_meta").select("*");
  for (const t of (tokens ?? []) as TokenMeta[]) {
    for (const c of await listarContas(t.token)) {
      encontradas.set(c.id, {
        id: c.id, nome: c.name, moeda: c.currency, fuso: c.timezone_name,
        status: c.account_status, bm_nome: c.business?.name ?? null,
        origem: "usuario", token_id: t.id, ...dadosFinanceiros(c),
      });
    }
  }
  // O token do seu BM tem prioridade: não expira.
  const tokenBm = process.env.META_SYSTEM_USER_TOKEN;
  if (tokenBm) {
    for (const c of await listarContas(tokenBm)) {
      encontradas.set(c.id, {
        id: c.id, nome: c.name, moeda: c.currency, fuso: c.timezone_name,
        status: c.account_status, bm_nome: c.business?.name ?? null,
        origem: "bm", token_id: null, ...dadosFinanceiros(c),
      });
    }
  }

  const linhas = [...encontradas.values()];
  if (linhas.length) {
    // upsert sem tocar em cliente_id, para não desfazer o vínculo com o cliente
    const { error } = await banco.from("contas_anuncio").upsert(linhas, { onConflict: "id" });
    if (error) throw new Error(error.message);
  }
  return linhas.length;
}

export type ModoSync = "hoje" | "semana" | "mes";

function intervalo(modo: ModoSync) {
  const ate = hojeISO();
  // "hoje" inclui ontem porque o fuso da conta pode estar atrás de Brasília.
  const dias = modo === "hoje" ? 1 : modo === "semana" ? 7 : 30;
  return { desde: diasAtras(dias), ate };
}

// Códigos que o Meta devolve quando o pedido tem dados demais ("An unknown error occurred",
// "Please reduce the amount of data you're asking for"): vale tentar com um período menor.
const ERROS_VOLUME = [1, 2, 500];

/** Busca os insights; se o Meta reclamar do volume, divide o período ao meio até chegar a 1 dia. */
async function insightsEmPartes(contaId: string, token: string, desde: string, ate: string): Promise<LinhaInsight[]> {
  try {
    return await insightsPorAnuncio(contaId, token, desde, ate);
  } catch (e) {
    const dias = diasEntre(desde, ate);
    if (!(e instanceof MetaErro) || !ERROS_VOLUME.includes(e.codigo ?? -1) || dias <= 1) throw e;
    const meio = somarDias(desde, Math.floor(dias / 2) - 1);
    const primeira = await insightsEmPartes(contaId, token, desde, meio);
    const segunda = await insightsEmPartes(contaId, token, somarDias(meio, 1), ate);
    return [...primeira, ...segunda];
  }
}

async function sincronizarConta(conta: ContaAnuncio, token: string, desde: string, ate: string) {
  const linhas = await insightsEmPartes(conta.id, token, desde, ate);
  const registros = linhas.map((l) => {
    const r = extrairResultados(l);
    return {
      conta_id: conta.id,
      data: l.date_start,
      ad_id: l.ad_id,
      ad_nome: l.ad_name,
      adset_id: l.adset_id,
      adset_nome: l.adset_name,
      campaign_id: l.campaign_id,
      campaign_nome: l.campaign_name,
      gasto: Number(l.spend ?? 0),
      impressoes: Number(l.impressions ?? 0),
      alcance: Number(l.reach ?? 0),
      cliques: Number(l.clicks ?? 0),
      cliques_link: Number(l.inline_link_clicks ?? 0),
      leads: r.leads,
      conversas: r.conversas,
      compras: r.compras,
      valor_compras: r.valorCompras,
      atualizado_em: new Date().toISOString(),
    };
  });
  const banco = db();
  for (let i = 0; i < registros.length; i += 500) {
    const { error } = await banco
      .from("metricas_diarias")
      .upsert(registros.slice(i, i + 500), { onConflict: "conta_id,data,ad_id" });
    if (error) throw new Error(error.message);
  }
  return registros.length;
}

/** Puxa as métricas de todas as contas ativas. Processa 3 contas por vez. */
export async function sincronizar(modo: ModoSync) {
  const banco = db();
  const { desde, ate } = intervalo(modo);
  const { data: exec } = await banco.from("sync_execucoes").insert({ modo }).select("id").single();
  const erros: string[] = [];

  // Atualiza status, saldo e limite de todas as contas (uma chamada por token, é barato).
  try {
    await importarContas();
  } catch (e) {
    erros.push(`Atualização de saldo/contas: ${e instanceof Error ? e.message : e}`);
  }

  // Métricas só das contas vinculadas a um cliente: as outras não aparecem no painel.
  const { data: contas } = await banco.from("contas_anuncio").select("*")
    .eq("ativa_sync", true).not("cliente_id", "is", null);
  const { data: tokens } = await banco.from("tokens_meta").select("id, token");
  const tokenPorId = new Map((tokens ?? []).map((t) => [t.id as string, t.token as string]));

  const fila = [...((contas ?? []) as ContaAnuncio[])];
  let totalLinhas = 0;

  async function trabalhador() {
    for (let conta = fila.shift(); conta; conta = fila.shift()) {
      const token =
        conta.origem === "bm" ? process.env.META_SYSTEM_USER_TOKEN : tokenPorId.get(conta.token_id ?? "");
      try {
        if (!token) throw new Error("Sem token para esta conta");
        totalLinhas += await sincronizarConta(conta, token, desde, ate);
        await banco.from("contas_anuncio")
          .update({ ultima_sync: new Date().toISOString(), ultimo_erro: null })
          .eq("id", conta.id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        erros.push(`${conta.nome}: ${msg}`);
        await banco.from("contas_anuncio").update({ ultimo_erro: msg }).eq("id", conta.id);
      }
    }
  }
  await Promise.all([trabalhador(), trabalhador(), trabalhador()]);

  const resultado = {
    contas: contas?.length ?? 0,
    linhas: totalLinhas,
    erros,
  };
  if (exec) {
    await banco.from("sync_execucoes").update({
      finalizado_em: new Date().toISOString(),
      status: erros.length ? "com_erros" : "ok",
      contas: resultado.contas,
      linhas: resultado.linhas,
      erros: erros.join("\n") || null,
    }).eq("id", exec.id);
  }
  return resultado;
}
