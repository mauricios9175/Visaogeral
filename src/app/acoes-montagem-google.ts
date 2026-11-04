"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { criarCampanhaPesquisa, criarCampanhaPmax, formatarIdGoogle } from "@/lib/google";
import { acessoGoogle } from "@/lib/acesso-google";
import { hojeISO } from "@/lib/datas";
import { aplicarNome } from "@/lib/modelos";
import { CORRESPONDENCIAS, normalizarGoogle, OBJETIVO_GOOGLE, OBJETIVO_PMAX, problemasDoAnuncio, type ConfigGoogle } from "@/lib/modelos-google";

export type ResultadoGoogle = { ok: boolean; mensagem: string; link: string | null };
export type ImagemPmax = { tipo: "logo" | "paisagem" | "quadrada" | "retrato"; dados: string };

const cheios = (l: string[]) => l.map((x) => x.trim()).filter(Boolean);

/** Monta a campanha no Google (Pesquisa ou Performance Max, pausada). Opcionalmente salva a configuração como modelo. */
export async function montarCampanhaGoogle(_: ResultadoGoogle | null, form: FormData): Promise<ResultadoGoogle> {
  let p: { clienteId: string; conta: string; config: ConfigGoogle; salvarModeloComo?: string; imagens?: ImagemPmax[] };
  try {
    p = JSON.parse(String(form.get("payload")));
  } catch {
    return { ok: false, mensagem: "Dados da montagem inválidos.", link: null };
  }
  const c = normalizarGoogle(p.config);
  const imagens = (p.imagens ?? []).filter((i) => i?.dados && ["logo", "paisagem", "quadrada", "retrato"].includes(i.tipo)).slice(0, 15);
  const pmax = c.tipo === "pmax";
  const problema = problemasDoAnuncio(c)
    ?? (!c.locais.length ? "Escolha pelo menos um local." : null)
    ?? (pmax && !imagens.some((i) => i.tipo === "logo") ? "Escolha o logo (quadrado)." : null)
    ?? (pmax && !imagens.some((i) => i.tipo === "paisagem") ? "Escolha pelo menos uma imagem paisagem." : null)
    ?? (pmax && !imagens.some((i) => i.tipo === "quadrada") ? "Escolha pelo menos uma imagem quadrada." : null);
  if (problema) return { ok: false, mensagem: problema, link: null };

  const banco = db();
  const { data: cliente } = await banco.from("clientes").select("id, nome").eq("id", p.clienteId).maybeSingle();
  if (!cliente) return { ok: false, mensagem: "Cliente não encontrado.", link: null };
  try {
    const { acesso, conta } = await acessoGoogle(p.conta);
    if (!conta || conta.cliente_id !== p.clienteId) throw new Error("Conta do Google não vinculada a este cliente.");
    const cidade = c.locais[0]?.nome.split(",")[0] ?? "";
    const data = hojeISO().split("-").reverse().slice(0, 2).join("/");
    const nome = aplicarNome(c.nomeCampanha, { cliente: cliente.nome, data, cidade, objetivo: pmax ? "PMax" : "Pesquisa" });
    const sufixo = (grupo: string) => c.parametrosUrl.trim()
      .replace(/\{campanha\}/g, encodeURIComponent(nome)).replace(/\{grupo\}/g, encodeURIComponent(grupo)).replace(/^[?&]/, "");
    const base = {
      nome, orcamentoDiario: c.orcamentoDiario, lance: c.lance, cpaDesejado: c.cpaDesejado, locais: c.locais.map((l) => l.id),
      sitelinks: c.sitelinks.filter((s) => s.texto.trim()).map((s) => ({
        texto: s.texto.trim(), descricao1: s.descricao1.trim(), descricao2: s.descricao2.trim(), url: (s.url || c.url).trim(),
      })),
      frases: cheios(c.frases),
    };
    let resumo: string;
    let campanhaId: string | null;
    if (pmax) {
      ({ campanhaId } = await criarCampanhaPmax(acesso, conta.id, conta.login_customer_id, {
        ...base, url: c.url.trim(), sufixoUrl: sufixo("pmax"), nomeEmpresa: c.pmax.nomeEmpresa.trim(),
        titulos: cheios(c.pmax.titulos), titulosLongos: cheios(c.pmax.titulosLongos), descricoes: cheios(c.pmax.descricoes),
        temas: cheios(c.pmax.temas), imagens,
      }));
      resumo = `Performance Max com ${cheios(c.pmax.titulos).length} títulos, ${imagens.length} imagem(ns) e ${cheios(c.pmax.temas).length} tema(s) de pesquisa`;
    } else {
      const grupos = c.grupos.filter((g) => g.palavras.length);
      ({ campanhaId } = await criarCampanhaPesquisa(acesso, conta.id, conta.login_customer_id, {
        ...base, parceiros: c.parceiros,
        negativas: c.negativas.map((n) => ({ texto: n.texto, tipo: CORRESPONDENCIAS[n.correspondencia].api })),
        grupos: grupos.map((g) => ({
          nome: g.nome, sufixoUrl: sufixo(g.nome), titulos: cheios(g.titulos), descricoes: cheios(g.descricoes),
          url: (g.url || c.url).trim(), caminho1: (g.caminho1 || c.caminho1).trim(), caminho2: (g.caminho1 ? g.caminho2 : g.caminho2 || c.caminho2).trim(),
          palavras: g.palavras.map((x) => ({ texto: x.texto, tipo: CORRESPONDENCIAS[x.correspondencia].api })),
        })),
      }));
      resumo = `${grupos.length} grupo(s) com anúncio próprio, ${grupos.reduce((t, g) => t + g.palavras.length, 0)} palavra(s)-chave e ${c.negativas.length} negativa(s)`;
    }
    if (base.sitelinks.length || base.frases.length) resumo += `, ${base.sitelinks.length} sitelink(s) e ${base.frases.length} frase(s) de destaque`;
    await banco.from("acoes_log").insert({
      plataforma: "google", cliente_id: p.clienteId, conta_id: conta.id, nivel: "campanha", objeto_id: campanhaId ?? "nova",
      objeto_nome: nome, acao: "montar", depois: "pausada", ok: true,
    }).then(() => null, () => null);

    let extra = "";
    if (p.salvarModeloComo?.trim()) {
      const { error } = await banco.from("modelos").insert({
        nome: p.salvarModeloComo.trim(), plataforma: "google", objetivo: pmax ? OBJETIVO_PMAX : OBJETIVO_GOOGLE, config: { ...c, locais: [] },
      });
      extra = error ? ` (não deu para salvar o modelo: ${error.message})` : ` Modelo “${p.salvarModeloComo.trim()}” salvo.`;
    }
    revalidatePath("/modelos");
    const link = campanhaId
      ? `https://ads.google.com/aw/${pmax ? "assetgroup" : "adgroups"}?campaignId=${campanhaId}&__c=${conta.id}${conta.login_customer_id ? `&__u=${conta.login_customer_id}` : ""}`
      : "https://ads.google.com/aw/campaigns";
    return {
      ok: true, link,
      mensagem: `Campanha “${nome}” criada PAUSADA na conta ${conta.nome} (${formatarIdGoogle(conta.id)}): ${resumo}. Revise no Google Ads e ative.${extra}`,
    };
  } catch (e) {
    return { ok: false, mensagem: `O Google não aceitou: ${e instanceof Error ? e.message : e}`, link: null };
  }
}
