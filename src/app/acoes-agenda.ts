"use server";

import { redirect } from "next/navigation";
import { desconectarAgenda, tornarPrincipal } from "@/lib/agenda";

const voltar = (msg: string) => redirect(`/configuracoes?msg=${encodeURIComponent(msg)}#agenda`);

export async function sairDaAgenda(form: FormData) {
  const email = String(form.get("email") ?? "");
  await desconectarAgenda(email);
  voltar(`Agenda ${email} desconectada.`);
}

export async function agendaPrincipal(form: FormData) {
  const email = String(form.get("email") ?? "");
  await tornarPrincipal(email);
  voltar(`${email} agora é a agenda principal (onde as reuniões são marcadas).`);
}
