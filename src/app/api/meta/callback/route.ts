import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { quemSou, trocarCodigoPorTokenLongo } from "@/lib/meta";
import { importarContas } from "@/lib/sync";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const voltar = (msg: string) =>
    NextResponse.redirect(new URL(`/configuracoes?msg=${encodeURIComponent(msg)}`, request.url));

  if (params.get("error")) return voltar("Login com Facebook cancelado.");
  const code = params.get("code");
  if (!code || params.get("state") !== request.cookies.get("meta_state")?.value) {
    return voltar("Falha na validação do login. Tente de novo.");
  }

  try {
    const redirect = new URL("/api/meta/callback", request.url).toString();
    const { token, expiraEm } = await trocarCodigoPorTokenLongo(code, redirect);
    const eu = await quemSou(token);
    const { error } = await db().from("tokens_meta").upsert(
      {
        fb_user_id: eu.id,
        nome: eu.name,
        token,
        expira_em: expiraEm?.toISOString() ?? null,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: "fb_user_id" },
    );
    if (error) throw new Error(error.message);
    const n = await importarContas();
    return voltar(`Conectado como ${eu.name}. ${n} contas encontradas no total.`);
  } catch (e) {
    return voltar(`Erro ao conectar: ${e instanceof Error ? e.message : e}`);
  }
}
