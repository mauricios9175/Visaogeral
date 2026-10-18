import { NextResponse, type NextRequest } from "next/server";
import { urlLogin } from "@/lib/meta";

// Inicia o "Login com Facebook" para puxar contas que estão no BM do cliente.
export async function GET(request: NextRequest) {
  const state = crypto.randomUUID();
  const redirect = new URL("/api/meta/callback", request.url).toString();
  const res = NextResponse.redirect(urlLogin(redirect, state));
  res.cookies.set("meta_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600 });
  return res;
}
