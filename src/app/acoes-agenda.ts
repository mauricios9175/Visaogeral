"use server";

import { redirect } from "next/navigation";
import { desconectarAgenda } from "@/lib/agenda";

export async function sairDaAgenda() {
  await desconectarAgenda();
  redirect(`/configuracoes?msg=${encodeURIComponent("Google Agenda desconectado.")}#agenda`);
}
