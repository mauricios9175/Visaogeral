import { NextResponse, type NextRequest } from "next/server";
import { urlLoginGoogle } from "@/lib/google";

// Inicia o "Login com Google" para ler as contas do Google Ads (diretas e de MCC).
export async function GET(request: NextRequest) {
  const state = crypto.randomUUID();
  const redirect = new URL("/api/google/callback", request.url).toString();
  const res = NextResponse.redirect(urlLoginGoogle(redirect, state));
  res.cookies.set("google_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600 });
  return res;
}
