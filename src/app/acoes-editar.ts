"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db, type ContaAnuncio } from "@/lib/db";
import { tokenDaConta } from "@/lib/sync";
import { salvarEdicao, type Edicao } from "@/lib/meta-editar";

/** Salva a edição de campanha, conjunto ou anúncio no Meta e volta para a tela de onde veio. */
export async function salvarEdicaoMeta(form: FormData) {
  const contaId = String(form.get("conta_id") ?? "");
  const destino = String(form.get("voltar") ?? "/");
  const voltar = (msg: string): never => {
    const u = new URL(destino.startsWith("/") && !destino.startsWith("//") ? destino : "/", "http://x");
    u.searchParams.set("msg", msg);
    redirect(`${u.pathname}${u.search}${u.hash}`);
  };
  let e: Edicao;
  try {
    e = JSON.parse(String(form.get("edicao")));
  } catch {
    voltar("Dados da edição inválidos.");
  }
  const banco = db();
  const { data: conta } = await banco.from("contas_anuncio").select("*").eq("id", contaId).maybeSingle();
  if (!conta) voltar("Conta do Meta não encontrada.");
  const token = await tokenDaConta(conta as ContaAnuncio);
  if (!token) voltar("Sem token para esta conta (reconecte o Facebook em Configurações).");
  let msg: string;
  const base = { plataforma: "meta", cliente_id: (conta as ContaAnuncio).cliente_id, conta_id: contaId, nivel: e!.nivel, objeto_id: e!.id, objeto_nome: e!.nome, acao: "editar" };
  try {
    const mudou = await salvarEdicao(e!, contaId, token!);
    msg = mudou.length ? `Salvo no Meta: ${mudou.join(", ")}.` : "Nada mudou.";
    if (mudou.length) await banco.from("acoes_log").insert({ ...base, depois: mudou.join(", ").slice(0, 500), ok: true }).then(() => null, () => null);
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    await banco.from("acoes_log").insert({ ...base, ok: false, erro: m }).then(() => null, () => null);
    msg = `O Meta não aceitou a edição: ${m}`;
  }
  revalidatePath("/", "layout");
  voltar(msg);
}
