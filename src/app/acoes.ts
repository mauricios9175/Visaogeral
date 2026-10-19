"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { COOKIE_SESSAO, criarSessao, senhaCorreta } from "@/lib/auth";
import { db } from "@/lib/db";
import { importarContas, sincronizar } from "@/lib/sync";
import { listarFunis } from "@/lib/crm/rd";
import { sincronizarCrmCliente, type ConexaoCrm } from "@/lib/crm/sync";

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
    ativo: form.get("ativo") !== "off",
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

export async function sincronizarAgora(form: FormData) {
  const modo = form.get("modo") === "mes" ? "mes" : "semana";
  let msg: string;
  try {
    const r = await sincronizar(modo);
    msg = `Sincronizado: ${r.contas} contas, ${r.linhas} linhas.` +
      (r.erros.length ? ` ${r.erros.length} com erro (veja na lista).` : "");
  } catch (e) {
    msg = `Erro na sincronização: ${e instanceof Error ? e.message : e}`;
  }
  revalidatePath("/", "layout");
  aviso(msg);
}

// ---------- CRM ----------

function avisoCrm(clienteId: string, msg: string): never {
  redirect(`/clientes/${clienteId}/crm?msg=${encodeURIComponent(msg)}`);
}

export async function salvarConexaoCrm(form: FormData) {
  const clienteId = String(form.get("cliente_id"));
  const tipo = String(form.get("tipo") ?? "rd_crm");
  const token = String(form.get("token") ?? "").trim();
  const banco = db();
  const { data: atual } = await banco.from("crm_conexoes").select("token").eq("cliente_id", clienteId).maybeSingle();
  const tokenFinal = token || atual?.token;
  if (!tokenFinal) avisoCrm(clienteId, "Informe o token do CRM.");
  let msg: string;
  try {
    const funis = await listarFunis(tokenFinal);
    const { error } = await banco.from("crm_conexoes").upsert(
      { cliente_id: clienteId, tipo, token: tokenFinal, ultimo_erro: null },
      { onConflict: "cliente_id" },
    );
    if (error) throw new Error(error.message);
    msg = `Conectado! ${funis.length} funil(is) encontrado(s). Agora escolha o funil e a etapa de qualificação.`;
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
  // Funil mudou: limpa os negócios antigos para não misturar funis.
  await db().from("crm_negocios").delete().eq("cliente_id", clienteId);
  revalidatePath("/", "layout");
  avisoCrm(clienteId, "Configuração salva. Clique em “Sincronizar CRM agora” para trazer os negócios.");
}

export async function sincronizarCrmAgora(form: FormData) {
  const clienteId = String(form.get("cliente_id"));
  const { data: conexao } = await db().from("crm_conexoes").select("*").eq("cliente_id", clienteId).maybeSingle();
  let msg: string;
  try {
    if (!conexao) throw new Error("Cliente sem CRM conectado.");
    const n = await sincronizarCrmCliente(conexao as ConexaoCrm, 90);
    msg = `CRM sincronizado: ${n} negócio(s) dos últimos 90 dias.`;
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
