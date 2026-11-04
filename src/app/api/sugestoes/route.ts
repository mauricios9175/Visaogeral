import { NextResponse, type NextRequest } from "next/server";
import { sugerirOtimizacoes } from "@/lib/sugestoes";

export const maxDuration = 120;

// Sugestões de otimização com IA (protegido pelo login do painel): { clienteId, p?, de?, ate? }
export async function POST(request: NextRequest) {
  const corpo = await request.json().catch(() => ({}));
  if (typeof corpo.clienteId !== "string" || !corpo.clienteId) return NextResponse.json({ erro: "cliente não informado" }, { status: 400 });
  try {
    return NextResponse.json(await sugerirOtimizacoes(corpo.clienteId, { p: corpo.p, de: corpo.de, ate: corpo.ate }));
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
