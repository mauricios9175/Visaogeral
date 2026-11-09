import { NextResponse, type NextRequest } from "next/server";
import { analisarCriativo, lerAnaliseCriativo } from "@/lib/analise-criativo";

export const maxDuration = 300;

// Análise de criativo com IA (protegido pelo login do painel):
//   GET ?ad=…                 → análise já feita (ou null)
//   POST { ad, clienteId }    → analisa agora (vídeo leva uns 30 a 90 s) e guarda
export async function GET(request: NextRequest) {
  const ad = request.nextUrl.searchParams.get("ad") ?? "";
  return NextResponse.json({ analise: /^\d+$/.test(ad) ? await lerAnaliseCriativo(ad).catch(() => null) : null });
}

export async function POST(request: NextRequest) {
  const corpo = await request.json().catch(() => ({}));
  if (!/^\d+$/.test(String(corpo.ad ?? "")) || typeof corpo.clienteId !== "string") return NextResponse.json({ erro: "pedido inválido" }, { status: 400 });
  try {
    return NextResponse.json({ analise: await analisarCriativo(String(corpo.ad), corpo.clienteId) });
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
