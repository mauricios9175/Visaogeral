"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { desligarLink, gerarLink } from "@/lib/portal";

/** Cria ou troca o link só de leitura do cliente. */
export async function gerarLinkCliente(form: FormData) {
  const clienteId = String(form.get("cliente_id") ?? "");
  let msg: string;
  try {
    await gerarLink(clienteId);
    msg = "Link do cliente criado. Copie e mande para ele (o anterior, se havia, parou de funcionar).";
  } catch (e) {
    msg = `Erro ao criar o link: ${e instanceof Error ? e.message : e}`;
  }
  revalidatePath(`/clientes/${clienteId}`);
  redirect(`/clientes/${clienteId}?msg=${encodeURIComponent(msg)}`);
}

export async function desligarLinkCliente(form: FormData) {
  const clienteId = String(form.get("cliente_id") ?? "");
  await desligarLink(clienteId);
  revalidatePath(`/clientes/${clienteId}`);
  redirect(`/clientes/${clienteId}?msg=${encodeURIComponent("Link do cliente desligado.")}`);
}
