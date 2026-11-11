import { NextResponse, type NextRequest } from "next/server";
import { PREFIXO_ESTADO, urlConectarAgenda } from "@/lib/agenda";

// Inicia o login com Google só para a agenda (pode ser outra conta Google, a da sua agenda).
// Volta pelo mesmo /api/google/callback do Google Ads, que reconhece o "agenda:" no state.
export async function GET(request: NextRequest) {
  const state = crypto.randomUUID();
  const redirect = new URL("/api/google/callback", request.url).toString();
  const res = NextResponse.redirect(urlConectarAgenda(redirect, state));
  res.cookies.set("google_state", `${PREFIXO_ESTADO}${state}`, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600 });
  return res;
}
