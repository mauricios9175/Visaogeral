import { NextResponse } from "next/server";
import { dadosSeletorPasta } from "@/lib/relatorio-slides";

// Token (só drive.file, 1 hora) e chave para abrir o seletor de pastas do Google (protegido pelo login do painel).
export async function GET() {
  try {
    return NextResponse.json(await dadosSeletorPasta());
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
