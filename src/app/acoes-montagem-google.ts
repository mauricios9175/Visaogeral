"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { criarCampanhaPesquisa, formatarIdGoogle } from "@/lib/google";
import { acessoGoogle } from "@/lib/acesso-google";
import { hojeISO } from "@/lib/datas";
import { aplicarNome } from "@/lib/modelos";
import { CORRESPONDENCIAS, normalizarGoogle, OBJETIVO_GOOGLE, problemasDoAnuncio, type ConfigGoogle } from "@/lib/modelos-google";

export type ResultadoGoogle = { ok: boolean; mensagem: string; link: string | null };

/** Monta a campanha de Pesquisa no Google (pausada). Opcionalmente salva a configuração como modelo. */
export async function montarCampanhaGoogle(_: ResultadoGoogle | null, form: FormData): Promise<ResultadoGoogle> {
  let p: { clienteId: string; conta: string; config: ConfigGoogle; salvarModeloComo?: string };
  try {
    p = JSON.parse(String(form.get("payload")));
  } catch {
    return { ok: false, mensagem: "Dados da montagem inválidos.", link: null };
  }
  const c = normalizarGoogle(p.config);
  const problema = problemasDoAnuncio(c) ?? (!c.locais.length ? "Escolha pelo menos um local." : null);
  if (problema) return { ok: false, mensagem: problema, link: null };

  const banco = db();
  const { data: cliente } = await banco.from("clientes").select("id, nome").eq("id", p.clienteId).maybeSingle();
  if (!cliente) return { ok: false, mensagem: "Cliente não encontrado.", link: null };
  try {
    const { acesso, conta } = await acessoGoogle(p.conta);
    if (!conta || conta.cliente_id !== p.clienteId) throw new Error("Conta do Google não vinculada a este cliente.");
    const cidade = c.locais[0]?.nome.split(",")[0] ?? "";
    const data = hojeISO().split("-").reverse().slice(0, 2).join("/");
    const nome = aplicarNome(c.nomeCampanha, { cliente: cliente.nome, data, cidade, objetivo: "Pesquisa" });
    const titulos = c.titulos.map((t) => t.trim()).filter(Boolean);
    const descricoes = c.descricoes.map((t) => t.trim()).filter(Boolean);
    const sufixo = (grupo: string) => c.parametrosUrl.trim()
      .replace(/\{campanha\}/g, encodeURIComponent(nome)).replace(/\{grupo\}/g, encodeURIComponent(grupo)).replace(/^[?&]/, "");
    const { campanhaId } = await criarCampanhaPesquisa(acesso, conta.id, conta.login_customer_id, {
      nome, orcamentoDiario: c.orcamentoDiario, lance: c.lance, cpaDesejado: c.cpaDesejado, parceiros: c.parceiros,
      locais: c.locais.map((l) => l.id),
      negativas: c.negativas.map((n) => ({ texto: n.texto, tipo: CORRESPONDENCIAS[n.correspondencia].api })),
      grupos: c.grupos.filter((g) => g.palavras.length).map((g) => ({
        nome: g.nome, sufixoUrl: sufixo(g.nome), titulos, descricoes,
        palavras: g.palavras.map((x) => ({ texto: x.texto, tipo: CORRESPONDENCIAS[x.correspondencia].api })),
      })),
      url: c.url.trim(), caminho1: c.caminho1.trim(), caminho2: c.caminho2.trim(),
    });
    await banco.from("acoes_log").insert({
      plataforma: "google", cliente_id: p.clienteId, conta_id: conta.id, nivel: "campanha", objeto_id: campanhaId ?? "nova",
      objeto_nome: nome, acao: "montar", depois: "pausada", ok: true,
    }).then(() => null, () => null);

    let extra = "";
    if (p.salvarModeloComo?.trim()) {
      const { error } = await banco.from("modelos").insert({ nome: p.salvarModeloComo.trim(), plataforma: "google", objetivo: OBJETIVO_GOOGLE, config: { ...c, locais: [] } });
      extra = error ? ` (não deu para salvar o modelo: ${error.message})` : ` Modelo “${p.salvarModeloComo.trim()}” salvo.`;
    }
    revalidatePath("/modelos");
    const link = campanhaId
      ? `https://ads.google.com/aw/adgroups?campaignId=${campanhaId}&__c=${conta.id}${conta.login_customer_id ? `&__u=${conta.login_customer_id}` : ""}`
      : "https://ads.google.com/aw/campaigns";
    return {
      ok: true, link,
      mensagem: `Campanha “${nome}” criada PAUSADA na conta ${conta.nome} (${formatarIdGoogle(conta.id)}): ${c.grupos.filter((g) => g.palavras.length).length} grupo(s), ` +
        `${c.grupos.reduce((t, g) => t + g.palavras.length, 0)} palavra(s)-chave e ${c.negativas.length} negativa(s). Revise no Google Ads e ative.${extra}`,
    };
  } catch (e) {
    return { ok: false, mensagem: `O Google não aceitou: ${e instanceof Error ? e.message : e}`, link: null };
  }
}
