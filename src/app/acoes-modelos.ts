"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { normalizarGoogle, OBJETIVO_GOOGLE, OBJETIVO_PMAX } from "@/lib/modelos-google";
import { MODELOS_PADRAO, normalizarConfig, normalizarFormulario, OBJETIVO_FORMULARIO, OBJETIVOS, type ObjetivoMeta } from "@/lib/modelos";

function aviso(msg: string, extra = ""): never {
  redirect(`/modelos?msg=${encodeURIComponent(msg)}${extra}`);
}

/** Salva um modelo de campanha de Pesquisa do Google. */
export async function salvarModeloGoogle(form: FormData) {
  const id = String(form.get("id") ?? "");
  const nome = String(form.get("nome") ?? "").trim();
  const volta = "&plataforma=google";
  if (!nome) aviso("Dê um nome ao modelo.", volta);
  let config;
  try {
    config = normalizarGoogle(JSON.parse(String(form.get("config") ?? "{}")));
  } catch {
    aviso("Não foi possível ler o modelo.", volta);
  }
  const dados = { nome, objetivo: config?.tipo === "pmax" ? OBJETIVO_PMAX : OBJETIVO_GOOGLE, plataforma: "google", config, atualizado_em: new Date().toISOString() };
  const { error } = id
    ? await db().from("modelos").update(dados).eq("id", id)
    : await db().from("modelos").insert(dados);
  revalidatePath("/modelos");
  aviso(error ? `Erro: ${error.message}` : "Modelo do Google salvo.", volta);
}

export async function salvarModelo(form: FormData) {
  const id = String(form.get("id") ?? "");
  const nome = String(form.get("nome") ?? "").trim();
  const objetivo = String(form.get("objetivo")) as ObjetivoMeta;
  if (!nome) aviso("Dê um nome ao modelo.");
  if (!(objetivo in OBJETIVOS)) aviso("Objetivo inválido.");
  let config;
  try {
    config = normalizarConfig(JSON.parse(String(form.get("config") ?? "{}")));
  } catch {
    aviso("Não foi possível ler o modelo.");
  }
  const dados = { nome, objetivo, plataforma: "meta", config, atualizado_em: new Date().toISOString() };
  const { error } = id
    ? await db().from("modelos").update(dados).eq("id", id)
    : await db().from("modelos").insert(dados);
  revalidatePath("/modelos");
  aviso(error ? `Erro: ${error.message}` : "Modelo salvo.");
}

export async function excluirModelo(form: FormData) {
  await db().from("modelos").delete().eq("id", String(form.get("id")));
  revalidatePath("/modelos");
  aviso("Modelo excluído.", form.get("plataforma") === "google" ? "&plataforma=google" : "");
}

/** Cria os três modelos prontos (formulário, WhatsApp e site) para começar. */
export async function criarModelosPadrao() {
  const { error } = await db().from("modelos").insert(
    MODELOS_PADRAO.map((m) => ({ nome: m.nome, objetivo: m.objetivo, plataforma: "meta", config: m.config })),
  );
  revalidatePath("/modelos");
  aviso(error ? `Erro: ${error.message} (rodou o SQL 0013?)` : "Modelos prontos criados. Edite à vontade.");
}

export async function salvarModeloFormulario(form: FormData) {
  const id = String(form.get("id") ?? "");
  const nome = String(form.get("nome") ?? "").trim();
  if (!nome) aviso("Dê um nome ao modelo de formulário.");
  let config;
  try {
    config = normalizarFormulario(JSON.parse(String(form.get("config") ?? "{}")));
  } catch {
    aviso("Não foi possível ler o formulário.");
  }
  const dados = { nome, objetivo: OBJETIVO_FORMULARIO, plataforma: "meta", config, atualizado_em: new Date().toISOString() };
  const { error } = id
    ? await db().from("modelos").update(dados).eq("id", id)
    : await db().from("modelos").insert(dados);
  revalidatePath("/modelos");
  redirect(`/modelos?msg=${encodeURIComponent(error ? `Erro: ${error.message}` : "Modelo de formulário salvo.")}#formularios`);
}
