import { NextResponse, type NextRequest } from "next/server";
import { db, type ContaAnuncio } from "@/lib/db";
import { formulariosDaPagina } from "@/lib/meta-montar";
import { tokenDaConta } from "@/lib/sync";

// Formulários instantâneos ativos de uma página.
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const { data } = await db().from("contas_anuncio").select("*").eq("id", q.get("conta") ?? "").maybeSingle();
  const token = data ? await tokenDaConta(data as ContaAnuncio) : undefined;
  if (!token) return NextResponse.json({ itens: [], erro: "Sem token para esta conta." });
  try {
    return NextResponse.json({ itens: await formulariosDaPagina(q.get("pagina") ?? "", token) });
  } catch (e) {
    return NextResponse.json({ itens: [], erro: `Não consegui listar os formulários (${e instanceof Error ? e.message : e}).` });
  }
}
