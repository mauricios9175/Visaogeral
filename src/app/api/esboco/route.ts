import { NextResponse, type NextRequest } from "next/server";
import { esbocarCampanha } from "@/lib/esboco";

export const maxDuration = 120;

// Esboço de campanha com IA (protegido pelo login do painel): { clienteId, pedido, contaId? } → objetivo + configuração
export async function POST(request: NextRequest) {
  const corpo = await request.json().catch(() => ({}));
  const pedido = typeof corpo.pedido === "string" ? corpo.pedido.trim().slice(0, 1000) : "";
  if (!pedido || typeof corpo.clienteId !== "string") return NextResponse.json({ erro: "Escreva o que a campanha precisa ter." }, { status: 400 });
  try {
    return NextResponse.json(await esbocarCampanha(corpo.clienteId, pedido, typeof corpo.contaId === "string" ? corpo.contaId : null));
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
