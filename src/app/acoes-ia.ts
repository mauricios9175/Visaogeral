"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { CHAVE_MANUAL, CHAVE_MANUAL_GOOGLE, chaveParams, MANUAL_GOOGLE_PADRAO, MANUAL_PADRAO, normalizarParams } from "@/lib/manual-ia";

/** Salva o manual do gestor (as regras que a IA segue). Vazio = volta ao padrão. */
export async function salvarManualIA(form: FormData) {
  const google = form.get("plataforma") === "google";
  const chave = google ? CHAVE_MANUAL_GOOGLE : CHAVE_MANUAL;
  const texto = String(form.get("texto") ?? "").trim().slice(0, 30_000);
  const restaurar = form.get("restaurar") === "1" || !texto || texto === (google ? MANUAL_GOOGLE_PADRAO : MANUAL_PADRAO).trim();
  const banco = db().from("configuracoes");
  const { error } = restaurar
    ? await banco.delete().eq("chave", chave)
    : await banco.upsert({ chave, valor: { texto }, atualizado_em: new Date().toISOString() });
  revalidatePath("/configuracoes");
  const msg = error ? `Erro ao salvar o manual: ${error.message}` : `Manual da IA${google ? " (Google)" : " (Meta)"} ${restaurar ? "voltou ao padrão" : "salvo"}.`;
  redirect(`/configuracoes?msg=${encodeURIComponent(msg)}#manual-ia`);
}

/** Salva os parâmetros de decisão de um cliente (tolerância, volume mínimo, qualificação mínima, observações). */
export async function salvarParamsIA(form: FormData) {
  const clienteId = String(form.get("cliente_id") ?? "");
  const voltar = String(form.get("voltar") ?? `/clientes/${clienteId}`);
  const valor = normalizarParams({
    tolerancia: Number(form.get("tolerancia")), diasMinimos: Number(form.get("diasMinimos")),
    gastoMinimo: Number(form.get("gastoMinimo")), leadsMinimos: Number(form.get("leadsMinimos")),
    qualificacaoMinima: Number(form.get("qualificacaoMinima")), notas: String(form.get("notas") ?? ""),
  });
  const { error } = await db().from("configuracoes").upsert({ chave: chaveParams(clienteId), valor, atualizado_em: new Date().toISOString() });
  revalidatePath(`/clientes/${clienteId}`);
  const sep = voltar.includes("?") ? "&" : "?";
  redirect(`${voltar.startsWith("/") ? voltar : `/clientes/${clienteId}`}${sep}msg=${encodeURIComponent(error ? `Erro: ${error.message}` : "Parâmetros da IA salvos.")}#sugestoes`);
}
