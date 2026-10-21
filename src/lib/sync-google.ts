import "server-only";
import { db } from "./db";
import { descobrirContas, metricasPorCampanha, tokenDeAcesso } from "./google";
import { diasAtras, hojeISO } from "./datas";

export type ContaGoogle = {
  id: string;
  cliente_id: string | null;
  nome: string;
  moeda: string | null;
  fuso: string | null;
  status: string | null;
  login_customer_id: string | null;
  gerente_nome: string | null;
  token_id: string | null;
  ativa_sync: boolean;
  ultima_sync: string | null;
  ultimo_erro: string | null;
};

type TokenGoogle = { id: string; email: string; refresh_token: string };

/** Busca no Google todas as contas (diretas e de MCC) dos logins conectados e cadastra/atualiza no banco. */
export async function importarContasGoogle() {
  const banco = db();
  const { data: tokens } = await banco.from("tokens_google").select("id, email, refresh_token");
  const linhas = new Map<string, Partial<ContaGoogle>>();
  const erros: string[] = [];
  for (const t of (tokens ?? []) as TokenGoogle[]) {
    try {
      const acesso = await tokenDeAcesso(t.refresh_token);
      const r = await descobrirContas(acesso);
      erros.push(...r.erros);
      for (const c of r.contas) {
        linhas.set(c.id, {
          id: c.id, nome: c.nome, moeda: c.moeda, fuso: c.fuso, status: c.status,
          login_customer_id: c.loginCustomerId, gerente_nome: c.gerenteNome, token_id: t.id,
        });
      }
    } catch (e) {
      erros.push(`${t.email}: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (linhas.size) {
    // upsert sem tocar em cliente_id nem ativa_sync
    const { error } = await banco.from("contas_google").upsert([...linhas.values()], { onConflict: "id" });
    if (error) throw new Error(error.message);
  }
  return { contas: linhas.size, erros };
}

async function sincronizarContaGoogle(conta: ContaGoogle, refreshToken: string, desde: string, ate: string) {
  const acesso = await tokenDeAcesso(refreshToken);
  const linhas = await metricasPorCampanha(acesso, conta.id, conta.login_customer_id, desde, ate);
  if (!linhas.length) return 0;
  const agora = new Date().toISOString();
  const { error } = await db().from("metricas_google").upsert(
    linhas.map((l) => ({
      conta_id: conta.id, data: l.data, campaign_id: l.campaignId, campaign_nome: l.campaignNome,
      campaign_status: l.campaignStatus, canal: l.canal, gasto: l.gasto, impressoes: l.impressoes,
      cliques: l.cliques, conversoes: l.conversoes, valor_conversoes: l.valorConversoes,
      conversoes_acao: l.conversoesAcao, atualizado_em: agora,
    })),
    { onConflict: "conta_id,data,campaign_id" },
  );
  if (error) throw new Error(error.message);
  return linhas.length;
}

/**
 * Puxa as métricas do Google Ads dos últimos `dias` (inclui hoje) de todas as contas vinculadas a clientes ativos.
 * O nível Explorer permite ~2.880 operações por dia: cada conta usa 1 ou 2 por sincronização.
 */
export async function sincronizarGoogle(dias: number) {
  const banco = db();
  const modo = `google ${dias}d`;
  const { data: exec } = await banco.from("sync_execucoes").insert({ modo }).select("id").single();
  const erros: string[] = [];
  const desde = diasAtras(dias), ate = hojeISO();

  const { data: contas } = await banco.from("contas_google").select("*, clientes!inner(ativo)")
    .eq("ativa_sync", true).eq("clientes.ativo", true);
  const { data: tokens } = await banco.from("tokens_google").select("id, refresh_token");
  const tokenPorId = new Map((tokens ?? []).map((t) => [t.id as string, t.refresh_token as string]));

  const fila = [...((contas ?? []) as ContaGoogle[])];
  let total = 0;
  async function trabalhador() {
    for (let conta = fila.shift(); conta; conta = fila.shift()) {
      try {
        const refresh = tokenPorId.get(conta.token_id ?? "");
        if (!refresh) throw new Error("Sem login do Google para esta conta (reconecte em Configurações)");
        total += await sincronizarContaGoogle(conta, refresh, desde, ate);
        await banco.from("contas_google").update({ ultima_sync: new Date().toISOString(), ultimo_erro: null }).eq("id", conta.id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        erros.push(`${conta.nome}: ${msg}`);
        await banco.from("contas_google").update({ ultimo_erro: msg }).eq("id", conta.id);
      }
    }
  }
  await Promise.all([trabalhador(), trabalhador(), trabalhador(), trabalhador()]);

  const resultado = { contas: contas?.length ?? 0, linhas: total, erros };
  if (exec) {
    await banco.from("sync_execucoes").update({
      finalizado_em: new Date().toISOString(),
      status: erros.length ? "com_erros" : "ok",
      contas: resultado.contas, linhas: total, erros: erros.join("\n") || null,
    }).eq("id", exec.id);
  }
  return resultado;
}
