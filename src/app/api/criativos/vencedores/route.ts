import { NextResponse, type NextRequest } from "next/server";
import { analisarVencedores, lerVencedores } from "@/lib/vencedores";

export const maxDuration = 300;

// "Por que os vencedores ganham" (protegido pelo login do painel):
//   GET ?cliente=<id>          → última análise (ou null)
//   POST { clienteId }         → compara agora os vencedores e os perdedores do cliente e guarda
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("cliente") ?? "";
  return NextResponse.json({ analise: id ? await lerVencedores(id).catch(() => null) : null });
}

export async function POST(request: NextRequest) {
  const corpo = await request.json().catch(() => ({}));
  if (typeof corpo.clienteId !== "string" || !corpo.clienteId) return NextResponse.json({ erro: "pedido inválido" }, { status: 400 });
  try {
    return NextResponse.json({ analise: await analisarVencedores(corpo.clienteId) });
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
