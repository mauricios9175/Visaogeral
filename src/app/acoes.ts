"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { COOKIE_SESSAO, criarSessao, senhaCorreta } from "@/lib/auth";
import { db, EMPRESA_PADRAO } from "@/lib/db";
import { importarContas } from "@/lib/sync";
import { importarContasGoogle, sincronizarGoogle } from "@/lib/sync-google";
import { PARAMETROS_UTM } from "@/lib/utm";
import { avisosUtm, listarFunisCrm, NOME_CRM, sincronizarCrmCliente, type ConexaoCrm, type TipoCrm } from "@/lib/crm/sync";

export async function entrar(_: unknown, form: FormData) {
  if (!senhaCorreta(String(form.get("senha") ?? ""))) return { erro: "Senha incorreta." };
  const { valor, maxAge } = await criarSessao();
  (await cookies()).set(COOKIE_SESSAO, valor, { httpOnly: true, secure: true, sameSite: "lax", maxAge, path: "/" });
  redirect("/");
}

export async function sair() {
  (await cookies()).delete(COOKIE_SESSAO);
  redirect("/login");
}

const numero = (v: FormDataEntryValue | null) => {
  let s = String(v ?? "").trim().replace(/^R\$\s*/, "");
  // "1.500,50" (formato BR) → "1500.50"; "150.5" fica como está
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  return s === "" || Number.isNaN(Number(s)) ? null : Number(s);
};

function aviso(msg: string): never {
  redirect(`/configuracoes?msg=${encodeURIComponent(msg)}`);
}

export async function salvarCliente(form: FormData) {
  const id = String(form.get("id") ?? "");
  const dados = {
    nome: String(form.get("nome") ?? "").trim(),
    nicho: String(form.get("nicho") ?? "").trim() || null,
    cpl_meta: numero(form.get("cpl_meta")),
    orcamento_mensal: numero(form.get("orcamento_mensal")),
    roas_meta: numero(form.get("roas_meta")),
    empresa: String(form.get("empresa") ?? "").trim() || EMPRESA_PADRAO,
  };
  if (!dados.nome) aviso("Informe o nome do cliente.");
  const banco = db();
  const { error } = id
    ? await banco.from("clientes").update(dados).eq("id", id)
    : await banco.from("clientes").insert(dados);
  if (error) aviso(`Erro: ${error.message}`);
  revalidatePath("/", "layout");
  aviso(id ? "Cliente atualizado." : "Cliente criado.");
}

/** Churn: tira o cliente da visão geral, dos alertas e da sincronização. O histórico fica guardado. */
export async function encerrarCliente(form: FormData) {
  const id = String(form.get("id"));
  const { error } = await db().from("clientes")
    .update({ ativo: false, churn_em: new Date().toISOString().slice(0, 10) }).eq("id", id);
  if (error) aviso(`Erro: ${error.message}`);
  revalidatePath("/", "layout");
  aviso("Cliente encerrado (churn). Ele saiu da visão geral; dá para reativar na lista de encerrados.");
}

export async function reativarCliente(form: FormData) {
  const id = String(form.get("id"));
  const { error } = await db().from("clientes").update({ ativo: true, churn_em: null }).eq("id", id);
  if (error) aviso(`Erro: ${error.message}`);
  revalidatePath("/", "layout");
  aviso("Cliente reativado.");
}

export async function vincularConta(form: FormData) {
  const conta = String(form.get("conta_id"));
  const cliente = String(form.get("cliente_id") ?? "") || null;
  const { error } = await db().from("contas_anuncio").update({ cliente_id: cliente }).eq("id", conta);
  if (error) aviso(`Erro: ${error.message}`);
  revalidatePath("/", "layout");
}

export async function alternarSyncConta(form: FormData) {
  const conta = String(form.get("conta_id"));
  const ativa = form.get("ativa") === "1";
  await db().from("contas_anuncio").update({ ativa_sync: ativa }).eq("id", conta);
  revalidatePath("/configuracoes");
}

export async function importar() {
  let msg: string;
  try {
    msg = `${await importarContas()} contas encontradas no Meta.`;
  } catch (e) {
    msg = `Erro ao buscar contas: ${e instanceof Error ? e.message : e}`;
  }
  revalidatePath("/", "layout");
  aviso(msg);
}

// ---------- Google Ads ----------

function avisoGoogle(msg: string): never {
  redirect(`/configuracoes?msg=${encodeURIComponent(msg)}#google`);
}

export async function importarGoogle() {
  let msg: string;
  try {
    const r = await importarContasGoogle();
    msg = `${r.contas} contas encontradas no Google Ads.${r.erros.length ? ` Avisos: ${r.erros.slice(0, 3).join(" | ")}` : ""}`;
  } catch (e) {
    msg = `Erro ao buscar contas do Google: ${e instanceof Error ? e.message : e}`;
  }
  revalidatePath("/", "layout");
  avisoGoogle(msg);
}

export async function sincronizarGoogleAgora(form: FormData) {
  const dias = Number(form.get("dias")) || 7;
  let msg: string;
  try {
    const r = await sincronizarGoogle(dias);
    msg = `Google Ads: ${r.contas} conta(s), ${r.linhas} linha(s) dos últimos ${dias} dias.` +
      (r.erros.length ? ` Erros: ${r.erros.join(" | ")}` : "");
  } catch (e) {
    msg = `Erro ao sincronizar o Google: ${e instanceof Error ? e.message : e}`;
  }
  revalidatePath("/", "layout");
  avisoGoogle(msg);
}

export async function vincularContaGoogle(form: FormData) {
  const conta = String(form.get("conta_id"));
  const cliente = String(form.get("cliente_id") ?? "") || null;
  const { error } = await db().from("contas_google").update({ cliente_id: cliente }).eq("id", conta);
  if (error) avisoGoogle(`Erro: ${error.message}`);
  revalidatePath("/", "layout");
}

export async function alternarSyncContaGoogle(form: FormData) {
  const conta = String(form.get("conta_id"));
  await db().from("contas_google").update({ ativa_sync: form.get("ativa") === "1" }).eq("id", conta);
  revalidatePath("/configuracoes");
}

export async function desconectarGoogle(form: FormData) {
  const id = String(form.get("id"));
  const { error } = await db().from("tokens_google").delete().eq("id", id);
  if (error) avisoGoogle(`Erro: ${error.message}`);
  revalidatePath("/", "layout");
  avisoGoogle("Login do Google removido. As contas ficam cadastradas, mas param de sincronizar até reconectar.");
}

// ---------- CRM ----------

function avisoCrm(clienteId: string, msg: string): never {
  redirect(`/clientes/${clienteId}/crm?msg=${encodeURIComponent(msg)}`);
}

export async function salvarConexaoCrm(form: FormData) {
  const clienteId = String(form.get("cliente_id"));
  const tipo = (String(form.get("tipo") ?? "rd_crm") as TipoCrm);
  const token = String(form.get("token") ?? "").trim();
  const locationId = String(form.get("location_id") ?? "").trim() || null;
  const banco = db();
  const { data: atual } = await banco.from("crm_conexoes").select("token, tipo").eq("cliente_id", clienteId).maybeSingle();
  // token em branco = manter o atual (só se for o mesmo CRM)
  const tokenFinal = token || (atual?.tipo === tipo ? atual?.token : undefined);
  if (!tokenFinal) avisoCrm(clienteId, "Informe o token do CRM.");
  if (tipo === "highlevel" && !locationId) avisoCrm(clienteId, "Informe o ID da subconta do Ávora.");
  let msg: string;
  try {
    const funis = await listarFunisCrm({ tipo, token: tokenFinal, location_id: locationId });
    if (atual && atual.tipo !== tipo) {
      // trocou de CRM: zera configuração e negócios antigos
      await banco.from("crm_negocios").delete().eq("cliente_id", clienteId);
      await banco.from("crm_conexoes").delete().eq("cliente_id", clienteId);
    }
    const { error } = await banco.from("crm_conexoes").upsert(
      { cliente_id: clienteId, tipo, token: tokenFinal, location_id: locationId, ultimo_erro: null },
      { onConflict: "cliente_id" },
    );
    if (error) throw new Error(error.message);
    msg = `${NOME_CRM[tipo]} conectado! ${funis.length} funil(is) encontrado(s). Agora escolha o funil e a etapa de qualificação.`;
  } catch (e) {
    msg = `Não foi possível conectar: ${e instanceof Error ? e.message : e}`;
  }
  revalidatePath("/", "layout");
  avisoCrm(clienteId, msg);
}

export async function salvarFunilCrm(form: FormData) {
  const clienteId = String(form.get("cliente_id"));
  // valor no formato "funilId|funilNome|etapaId|etapaNome|etapaOrdem"
  const [pipelineId, pipelineNome, etapaId, etapaNome, etapaOrdem] = String(form.get("escolha") ?? "").split("|");
  const { error } = await db().from("crm_conexoes").update({
    pipeline_id: pipelineId || null,
    pipeline_nome: pipelineNome || null,
    etapa_qualificado: etapaId || null,
    etapa_qualificado_nome: etapaNome || null,
    etapa_qualificado_ordem: etapaOrdem ? Number(etapaOrdem) : null,
  }).eq("cliente_id", clienteId);
  if (error) avisoCrm(clienteId, `Erro: ${error.message}`);
  revalidatePath("/", "layout");
  avisoCrm(clienteId, "Etapa de qualificação salva.");
}

export async function sincronizarCrmAgora(form: FormData) {
  const clienteId = String(form.get("cliente_id"));
  const { data: conexao } = await db().from("crm_conexoes").select("*").eq("cliente_id", clienteId).maybeSingle();
  let msg: string;
  try {
    if (!conexao) throw new Error("Cliente sem CRM conectado.");
    const n = await sincronizarCrmCliente(conexao as ConexaoCrm, 90);
    const aviso = avisosUtm.get(clienteId);
    msg = `CRM sincronizado: ${n} negócio(s) dos últimos 90 dias.` +
      (aviso ? ` Atenção: ${aviso}. Sem isso, as UTMs dos contatos não aparecem.` : "");
  } catch (e) {
    msg = `Erro ao sincronizar o CRM: ${e instanceof Error ? e.message : e}`;
  }
  revalidatePath("/", "layout");
  avisoCrm(clienteId, msg);
}

export async function removerConexaoCrm(form: FormData) {
  const clienteId = String(form.get("cliente_id"));
  await db().from("crm_negocios").delete().eq("cliente_id", clienteId);
  await db().from("crm_conexoes").delete().eq("cliente_id", clienteId);
  revalidatePath("/", "layout");
  avisoCrm(clienteId, "Conexão com o CRM removida.");
}

export async function salvarFontesCrm(form: FormData) {
  const clienteId = String(form.get("cliente_id"));
  const fontes = form.getAll("fonte").map(String);
  const { error } = await db().from("crm_conexoes")
    .update({ fontes_anuncio: fontes }).eq("cliente_id", clienteId);
  if (error) avisoCrm(clienteId, `Erro: ${error.message}`);
  revalidatePath("/", "layout");
  avisoCrm(clienteId, `Fontes de anúncio salvas (${fontes.length}).`);
}

/** Qual campo do CRM corresponde a cada UTM (vazio = detectar pelo nome do campo). */
export async function salvarMapaUtm(form: FormData) {
  const clienteId = String(form.get("cliente_id"));
  const mapa = Object.fromEntries(
    PARAMETROS_UTM.map((p) => [p, String(form.get(`utm_${p}`) ?? "")] as const).filter(([, v]) => v),
  );
  const { error } = await db().from("crm_conexoes").update({ mapa_utm: Object.keys(mapa).length ? mapa : null }).eq("cliente_id", clienteId);
  revalidatePath("/", "layout");
  avisoCrm(clienteId, error ? `Erro: ${error.message} (rodou o SQL 0014?)` : "Mapa de UTMs salvo. O relatório por UTM já usa os campos escolhidos.");
}

/** Segunda etapa do funil (Propostas, Projetos, Agendamentos…) e como o cliente chama cada etapa no relatório. */
export async function salvarEtapaProposta(form: FormData) {
  const clienteId = String(form.get("cliente_id"));
  // valor no formato "funilId|funilNome|etapaId|etapaNome|etapaOrdem" (vazio = sem etapa de propostas)
  const [pipelineId, , etapaId, etapaNome, etapaOrdem] = String(form.get("escolha") ?? "").split("|");
  const rotulos = Object.fromEntries(
    ["leads", "interessados", "propostas", "vendas"]
      .map((k) => [k, String(form.get(`rotulo_${k}`) ?? "").trim()] as const)
      .filter(([, v]) => v),
  );
  const { error } = await db().from("crm_conexoes").update({
    pipeline_proposta_id: pipelineId || null,
    etapa_proposta: etapaId || null,
    etapa_proposta_nome: etapaNome || null,
    etapa_proposta_ordem: etapaOrdem ? Number(etapaOrdem) : null,
    rotulos: Object.keys(rotulos).length ? rotulos : null,
  }).eq("cliente_id", clienteId);
  revalidatePath("/", "layout");
  avisoCrm(clienteId, error ? `Erro: ${error.message} (rodou o SQL 0015?)` : "Etapas do funil salvas.");
}
