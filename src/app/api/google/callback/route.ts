import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { trocarCodigoGoogle } from "@/lib/google";
import { importarContasGoogle } from "@/lib/sync-google";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const voltar = (msg: string) =>
    NextResponse.redirect(new URL(`/configuracoes?msg=${encodeURIComponent(msg)}#google`, request.url));

  if (params.get("error")) return voltar("Login com Google cancelado.");
  const code = params.get("code");
  if (!code || params.get("state") !== request.cookies.get("google_state")?.value) {
    return voltar("Falha na validação do login com Google. Tente de novo.");
  }

  try {
    const redirect = new URL("/api/google/callback", request.url).toString();
    const { refreshToken, email } = await trocarCodigoGoogle(code, redirect);
    const { error } = await db().from("tokens_google").upsert(
      { email, refresh_token: refreshToken, atualizado_em: new Date().toISOString() },
      { onConflict: "email" },
    );
    if (error) throw new Error(error.message);
    const r = await importarContasGoogle();
    const avisos = r.erros.length ? ` Avisos: ${r.erros.slice(0, 3).join(" | ")}` : "";
    return voltar(`Google conectado (${email}). ${r.contas} contas encontradas.${avisos}`);
  } catch (e) {
    return voltar(`Erro ao conectar o Google: ${e instanceof Error ? e.message : e}`);
  }
}
