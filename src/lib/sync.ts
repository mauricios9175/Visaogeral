import "server-only";
import { db, type ContaAnuncio, type TokenMeta } from "./db";
import {
  buscarPorIds, criativosDosAnuncios, dadosFinanceiros, extrairResultados, insightsPorAnuncio, listarContas, MetaErro,
  metricasVideo, type CriativoMeta, type LinhaInsight, type ObjetivoConjunto,
} from "./meta";
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

/** Guarda o status atual (ativo, pausado, reprovado...) de campanhas, conjuntos e anúncios. */
async function salvarStatus(
  conta: ContaAnuncio,
  linhas: { id: string; nivel: string; status?: string; daily_budget?: string; lifetime_budget?: string }[],
) {
  try {
    const agora = new Date().toISOString();
    const registros = linhas
      .filter((l) => l.status)
      .map((l) => ({
        id: l.id, nivel: l.nivel, status: l.status!, conta_id: conta.id, atualizado_em: agora,
        // orçamento em reais (o Meta manda em centavos); null = o orçamento fica no outro nível
        orcamento_diario: l.daily_budget ? Number(l.daily_budget) / 100 : null,
        orcamento_total: l.lifetime_budget ? Number(l.lifetime_budget) / 100 : null,
      }));
    for (let i = 0; i < registros.length; i += 500) {
      let { error } = await db().from("status_meta").upsert(registros.slice(i, i + 500), { onConflict: "id" });
      // sem o SQL 0012 as colunas de orçamento não existem: salva só o status
      if (error && /orcamento/.test(error.message)) {
        ({ error } = await db().from("status_meta").upsert(
          registros.slice(i, i + 500).map(({ orcamento_diario, orcamento_total, ...r }) => (void orcamento_diario, void orcamento_total, r)),
          { onConflict: "id" },
        ));
      }
      if (error) throw new Error(error.message);
    }
  } catch (e) {
    // Status é informativo: falha aqui não deve impedir de salvar as métricas.
    console.error(`Status de ${conta.nome}:`, e);
  }
}

/** As colunas de vídeo existem? (SQL 0010) Sem elas, salva as métricas sem vídeo em vez de falhar. */
let temColunasVideo: boolean | null = null;
async function colunasDeVideo() {
  if (temColunasVideo === null) {
    const { error } = await db().from("metricas_diarias").select("video_3s").limit(1);
    temColunasVideo = !error;
  }
  return temColunasVideo;
}

/** Guarda miniatura, tipo e link de cada anúncio. Informativo: falha aqui não impede as métricas. */
async function salvarCriativos(conta: ContaAnuncio, anuncios: Map<string, CriativoMeta>) {
  try {
    const agora = new Date().toISOString();
    const registros = [...anuncios.values()].filter((a) => a.creative).map((a) => {
      const c = a.creative!;
      return {
        ad_id: a.id, conta_id: conta.id, tipo: c.object_type ?? (c.video_id ? "VIDEO" : null),
        thumbnail_url: c.thumbnail_url ?? null, imagem_url: c.image_url ?? null, video_id: c.video_id ?? null,
        titulo: c.title ?? null, texto: c.body ?? null,
        link: c.instagram_permalink_url ?? (c.effective_object_story_id ? `https://www.facebook.com/${c.effective_object_story_id}` : null),
        atualizado_em: agora,
      };
    });
    for (let i = 0; i < registros.length; i += 500) {
      const { error } = await db().from("criativos_meta").upsert(registros.slice(i, i + 500), { onConflict: "ad_id" });
      if (error) throw new Error(error.message);
    }
  } catch (e) {
    console.error(`Criativos de ${conta.nome}:`, e);
  }
}

async function sincronizarConta(conta: ContaAnuncio, token: string, desde: string, ate: string) {
  const linhas = await insightsEmPartes(conta.id, token, desde, ate);
  // Objetivo e status só dos itens que veicularam no período (pelo id, 50 por chamada).
  type Obj = { id: string; effective_status?: string; daily_budget?: string; lifetime_budget?: string };
  const [conjuntos, campanhas, anuncios] = await Promise.all([
    buscarPorIds<ObjetivoConjunto & Obj>(linhas.map((l) => l.adset_id), token, "id,effective_status,optimization_goal,promoted_object,daily_budget,lifetime_budget"),
    buscarPorIds<Obj>(linhas.map((l) => l.campaign_id), token, "id,effective_status,daily_budget,lifetime_budget"),
    // anúncios: status + criativo (miniatura, tipo e link) para o painel de criativos
    criativosDosAnuncios(linhas.map((l) => l.ad_id), token),
  ]).catch((e) => {
    console.error(`Objetivos/status de ${conta.nome}:`, e);
    return [undefined, undefined, undefined] as const;
  });
  await salvarStatus(conta, [
    ...[...(campanhas?.values() ?? [])].map((c) => ({ ...c, nivel: "campanha", status: c.effective_status })),
    ...[...(conjuntos?.values() ?? [])].map((c) => ({ ...c, nivel: "conjunto", status: c.effective_status })),
    ...[...(anuncios?.values() ?? [])].map((a) => ({ id: a.id, nivel: "anuncio", status: a.effective_status })),
  ]);
  if (anuncios) await salvarCriativos(conta, anuncios);
  const comVideo = await colunasDeVideo();
  const registros = linhas.map((l) => {
    const r = extrairResultados(l, conjuntos);
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
      resultados: r.resultados,
      resultado_tipo: r.tipo,
      resultado_acao: r.acao,
      ...(comVideo ? metricasVideo(l) : {}),
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
  // Só contas de clientes ativos (cliente em churn para de sincronizar).
  const { data: contas } = await banco.from("contas_anuncio").select("*, clientes!inner(ativo)")
    .eq("ativa_sync", true).eq("clientes.ativo", true);
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

/** Token a usar para uma conta (BM ou o perfil conectado pelo Login com Facebook). */
export async function tokenDaConta(conta: ContaAnuncio): Promise<string | undefined> {
  if (conta.origem === "bm") return process.env.META_SYSTEM_USER_TOKEN;
  if (!conta.token_id) return undefined;
  const { data } = await db().from("tokens_meta").select("token").eq("id", conta.token_id).maybeSingle();
  return data?.token as string | undefined;
}

// ---------- Sincronização conta a conta (usada pela tela, com barra de progresso) ----------

/** Contas que entram na sincronização: ativas e de clientes ativos. */
export async function contasParaSincronizar() {
  const { data } = await db().from("contas_anuncio").select("id, nome, clientes!inner(nome, ativo)")
    .eq("ativa_sync", true).eq("clientes.ativo", true).order("nome");
  return ((data ?? []) as unknown as { id: string; nome: string; clientes: { nome: string } }[])
    .map((c) => ({ id: c.id, nome: c.nome, cliente: c.clientes.nome }));
}

/** Sincroniza uma conta só. Lança o erro com uma mensagem legível. */
export async function sincronizarContaPorId(contaId: string, modo: ModoSync) {
  const banco = db();
  const { data } = await banco.from("contas_anuncio").select("*").eq("id", contaId).maybeSingle();
  if (!data) throw new Error("Conta não encontrada");
  const conta = data as ContaAnuncio;
  const { desde, ate } = intervalo(modo);
  try {
    const token = await tokenDaConta(conta);
    if (!token) throw new Error("Sem token para esta conta (reconecte o Facebook em Configurações)");
    const linhas = await sincronizarConta(conta, token, desde, ate);
    await banco.from("contas_anuncio").update({ ultima_sync: new Date().toISOString(), ultimo_erro: null }).eq("id", conta.id);
    return linhas;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await banco.from("contas_anuncio").update({ ultimo_erro: msg }).eq("id", conta.id);
    throw new Error(msg);
  }
}

/** Registra no histórico ("Últimas sincronizações") uma sincronização feita pela tela. */
export async function registrarExecucao(modo: string, contas: number, linhas: number, erros: string[]) {
  await db().from("sync_execucoes").insert({
    modo,
    finalizado_em: new Date().toISOString(),
    status: erros.length ? "com_erros" : "ok",
    contas,
    linhas,
    erros: erros.join("\n") || null,
  });
}
