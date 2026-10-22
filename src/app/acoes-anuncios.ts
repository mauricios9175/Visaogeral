"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db, type ContaAnuncio } from "@/lib/db";
import { mudarOrcamento, mudarStatus, orcamentoDe } from "@/lib/meta";
import { mudarOrcamentoGoogle, mudarStatusCampanhaGoogle, orcamentoCampanhaGoogle, tokenDeAcesso } from "@/lib/google";
import { tokenDaConta } from "@/lib/sync";
import { dinheiro } from "@/lib/formato";

// Ações rápidas: pausar, ativar e mudar orçamento no Meta e no Google, sem abrir o Gerenciador.
// Tudo fica registrado em acoes_log (histórico de otimizações).

/** Volta para a tela de onde a ação veio, com a mensagem. Só aceita caminhos internos. */
function voltar(form: FormData, msg: string): never {
  const destino = String(form.get("voltar") ?? "/");
  const u = new URL(destino.startsWith("/") && !destino.startsWith("//") ? destino : "/", "http://x");
  u.searchParams.set("msg", msg);
  redirect(`${u.pathname}${u.search}${u.hash}`);
}

type Registro = {
  plataforma: "meta" | "google"; cliente_id: string | null; conta_id: string; nivel: string;
  objeto_id: string; objeto_nome: string | null; acao: string; antes?: string | null; depois?: string | null;
};

async function registrar(r: Registro, erro?: unknown) {
  // o histórico não pode impedir a ação (ex.: SQL 0012 ainda não rodado)
  await db().from("acoes_log").insert({
    ...r, ok: !erro, erro: erro ? (erro instanceof Error ? erro.message : String(erro)) : null,
  }).then(() => null, () => null);
}

/** Novo orçamento: por fator (ex.: 1.2 = +20%) ou valor digitado ("80" ou "80,50"). */
function novoValor(form: FormData, atual: number) {
  const fator = Number(form.get("fator"));
  if (fator > 0) return Math.round(atual * fator * 100) / 100;
  const v = Number(String(form.get("valor") ?? "").replace(/\./g, "").replace(",", "."));
  return v > 0 ? Math.round(v * 100) / 100 : null;
}

const NIVEL: Record<string, string> = { campanha: "campanha", conjunto: "conjunto", anuncio: "anúncio" };

export async function acaoMeta(form: FormData) {
  const contaId = String(form.get("conta_id"));
  const objetoId = String(form.get("objeto_id"));
  const nivel = String(form.get("nivel")) as "campanha" | "conjunto" | "anuncio";
  const acao = String(form.get("acao"));
  const nome = String(form.get("nome") ?? "") || null;
  const banco = db();
  const { data: conta } = await banco.from("contas_anuncio").select("*").eq("id", contaId).maybeSingle();
  if (!conta) voltar(form, "Conta não encontrada.");
  const base = { plataforma: "meta" as const, cliente_id: (conta as ContaAnuncio).cliente_id, conta_id: contaId, nivel, objeto_id: objetoId, objeto_nome: nome };

  let msg: string;
  try {
    const token = await tokenDaConta(conta as ContaAnuncio);
    if (!token) throw new Error("Sem token para esta conta (reconecte o Facebook em Configurações).");
    if (acao === "pausar" || acao === "ativar") {
      await mudarStatus(objetoId, token, acao === "ativar");
      await banco.from("status_meta").update({ status: acao === "ativar" ? "ACTIVE" : "PAUSED" }).eq("id", objetoId);
      await registrar({ ...base, acao, antes: acao === "ativar" ? "pausado" : "ativo", depois: acao === "ativar" ? "ativo" : "pausado" });
      msg = `${acao === "ativar" ? "Ativado" : "Pausado"} no Meta: ${NIVEL[nivel]} “${nome ?? objetoId}”.`;
    } else if (acao === "orcamento") {
      if (nivel === "anuncio") throw new Error("Anúncio não tem orçamento; mude no conjunto ou na campanha.");
      const o = await orcamentoDe(objetoId, token, nivel);
      if (!o) throw new Error("Não encontrei orçamento neste item.");
      const atual = o.diario ?? o.total!;
      const novo = novoValor(form, atual);
      if (!novo) throw new Error("Informe um valor de orçamento válido.");
      await mudarOrcamento(o, token, novo);
      const campo = o.diario != null ? "orcamento_diario" : "orcamento_total";
      await banco.from("status_meta").update({ [campo]: novo }).eq("id", o.id).then(() => null, () => null);
      const tipo = o.diario != null ? "/dia" : " (total)";
      await registrar({ ...base, nivel: o.nivel, objeto_id: o.id, objeto_nome: o.nome, acao, antes: `${dinheiro(atual)}${tipo}`, depois: `${dinheiro(novo)}${tipo}` });
      msg = `Orçamento ${o.nivel === "campanha" && nivel === "conjunto" ? "da campanha (orçamento de campanha) " : ""}“${o.nome}”: ${dinheiro(atual)} → ${dinheiro(novo)}${tipo}.`;
    } else {
      throw new Error("Ação desconhecida.");
    }
  } catch (e) {
    await registrar({ ...base, acao }, e);
    msg = `Não foi possível concluir no Meta: ${e instanceof Error ? e.message : e}`;
  }
  revalidatePath("/", "layout");
  voltar(form, msg);
}

export async function acaoGoogle(form: FormData) {
  const contaId = String(form.get("conta_id"));
  const campanhaId = String(form.get("objeto_id"));
  const acao = String(form.get("acao"));
  const nome = String(form.get("nome") ?? "") || null;
  const banco = db();
  const { data: conta } = await banco.from("contas_google").select("id, cliente_id, login_customer_id, token_id").eq("id", contaId).maybeSingle();
  if (!conta) voltar(form, "Conta do Google não encontrada.");
  const base = { plataforma: "google" as const, cliente_id: conta.cliente_id, conta_id: contaId, nivel: "campanha", objeto_id: campanhaId, objeto_nome: nome };

  let msg: string;
  try {
    const { data: t } = await banco.from("tokens_google").select("refresh_token").eq("id", conta.token_id ?? "").maybeSingle();
    if (!t) throw new Error("Sem login do Google para esta conta (reconecte em Configurações).");
    const acesso = await tokenDeAcesso(t.refresh_token);
    if (acao === "pausar" || acao === "ativar") {
      await mudarStatusCampanhaGoogle(acesso, contaId, conta.login_customer_id, campanhaId, acao === "ativar");
      // reflete na tela até a próxima sincronização
      await banco.from("metricas_google").update({ campaign_status: acao === "ativar" ? "ENABLED" : "PAUSED" })
        .eq("conta_id", contaId).eq("campaign_id", campanhaId);
      await registrar({ ...base, acao, antes: acao === "ativar" ? "pausada" : "ativa", depois: acao === "ativar" ? "ativa" : "pausada" });
      msg = `${acao === "ativar" ? "Ativada" : "Pausada"} no Google: campanha “${nome ?? campanhaId}”.`;
    } else if (acao === "orcamento") {
      const o = await orcamentoCampanhaGoogle(acesso, contaId, conta.login_customer_id, campanhaId);
      if (!o) throw new Error("Não encontrei o orçamento desta campanha.");
      const novo = novoValor(form, o.diario);
      if (!novo) throw new Error("Informe um valor de orçamento válido.");
      await mudarOrcamentoGoogle(acesso, contaId, conta.login_customer_id, o, novo);
      await banco.from("metricas_google").update({ orcamento_diario: novo })
        .eq("conta_id", contaId).eq("campaign_id", campanhaId).then(() => null, () => null);
      await registrar({ ...base, acao, antes: `${dinheiro(o.diario)}/dia`, depois: `${dinheiro(novo)}/dia` });
      msg = `Orçamento no Google “${o.campanha ?? nome}”: ${dinheiro(o.diario)} → ${dinheiro(novo)}/dia` +
        (o.compartilhado ? ` (orçamento compartilhado “${o.nome}”: vale para todas as campanhas que o usam).` : ".");
    } else {
      throw new Error("Ação desconhecida.");
    }
  } catch (e) {
    await registrar({ ...base, acao }, e);
    msg = `Não foi possível concluir no Google: ${e instanceof Error ? e.message : e}`;
  }
  revalidatePath("/", "layout");
  voltar(form, msg);
}

// ---------- Saldo do Google (recargas) ----------

export async function registrarRecargaGoogle(form: FormData) {
  const contaId = String(form.get("conta_id"));
  const tipo = form.get("tipo") === "saldo" ? "saldo" : "recarga";
  const data = String(form.get("data") ?? "");
  const valor = Number(String(form.get("valor") ?? "").replace(/^R\$\s*/, "").replace(/\./g, "").replace(",", "."));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !(valor >= 0)) voltar(form, "Informe a data e o valor.");
  const { error } = await db().from("recargas_google").insert({ conta_id: contaId, data, valor, tipo });
  revalidatePath("/", "layout");
  voltar(form, error ? `Erro: ${error.message}` : tipo === "saldo" ? "Saldo informado salvo." : `Recarga de ${dinheiro(valor)} registrada.`);
}

export async function removerRecargaGoogle(form: FormData) {
  await db().from("recargas_google").delete().eq("id", Number(form.get("id")));
  revalidatePath("/", "layout");
  voltar(form, "Registro removido.");
}
