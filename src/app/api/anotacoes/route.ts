import { NextResponse, type NextRequest } from "next/server";
import { excluirAnotacao, listarAnotacoes, salvarAnotacao } from "@/lib/anotacoes";

// Anotações gerais (protegido pelo login do painel).
//   GET                                   → { anotacoes }
//   POST { op: "salvar", anotacao: {...} } → { anotacoes }  (sem id: cria)
//   POST { op: "excluir", id }            → { anotacoes }
export async function GET() {
  return NextResponse.json({ anotacoes: await listarAnotacoes() });
}

export async function POST(request: NextRequest) {
  const corpo = await request.json().catch(() => ({}));
  try {
    if (corpo.op === "salvar") return NextResponse.json({ anotacoes: await salvarAnotacao(corpo.anotacao ?? {}) });
    if (corpo.op === "excluir") return NextResponse.json({ anotacoes: await excluirAnotacao(String(corpo.id ?? "")) });
    return NextResponse.json({ erro: "op inválida" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
