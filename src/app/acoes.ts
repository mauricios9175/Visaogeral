"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { COOKIE_SESSAO, criarSessao, senhaCorreta } from "@/lib/auth";
import { db } from "@/lib/db";
import { importarContas, sincronizar } from "@/lib/sync";

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
