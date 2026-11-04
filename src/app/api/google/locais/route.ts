import { NextResponse, type NextRequest } from "next/server";
import { buscarLocaisGoogle } from "@/lib/google";
import { acessoGoogle } from "@/lib/acesso-google";

// Busca de locais do Google Ads (protegida pelo login do painel): ?q=curitiba&conta=1234567890
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ itens: [] });
  try {
    const { acesso, conta } = await acessoGoogle(request.nextUrl.searchParams.get("conta"));
    return NextResponse.json({ itens: await buscarLocaisGoogle(acesso, conta?.login_customer_id ?? null, q) });
  } catch (e) {
    return NextResponse.json({ itens: [], erro: e instanceof Error ? e.message : String(e) });
  }
}
