import { NextResponse, type NextRequest } from "next/server";
import { marcarSugestao, sugerirOtimizacoes } from "@/lib/sugestoes";

export const maxDuration = 120;

// Sugestões de otimização com IA (protegido pelo login do painel):
//   { clienteId, p?, de?, ate? }                    → gera novas (e guarda no histórico)
//   { clienteId, marcar: { id, indice, feito } }    → marca uma sugestão como feita
export async function POST(request: NextRequest) {
  const corpo = await request.json().catch(() => ({}));
  if (typeof corpo.clienteId !== "string" || !corpo.clienteId) return NextResponse.json({ erro: "cliente não informado" }, { status: 400 });
  try {
    const m = corpo.marcar;
    if (m && typeof m.id === "string") return NextResponse.json(await marcarSugestao(corpo.clienteId, m.id, Number(m.indice), Boolean(m.feito)));
    return NextResponse.json(await sugerirOtimizacoes(corpo.clienteId, { p: corpo.p, de: corpo.de, ate: corpo.ate }, corpo.plataforma === "google" ? "google" : "meta"));
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
