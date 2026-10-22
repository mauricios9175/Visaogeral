import { NextResponse, type NextRequest } from "next/server";
import { db, type ContaAnuncio } from "@/lib/db";
import { ativosDaConta } from "@/lib/meta-montar";
import { tokenDaConta } from "@/lib/sync";

// Páginas, Instagram e pixels de uma conta de anúncio (para a montagem de campanhas).
export async function GET(request: NextRequest) {
  const contaId = request.nextUrl.searchParams.get("conta") ?? "";
  const { data } = await db().from("contas_anuncio").select("*").eq("id", contaId).maybeSingle();
  const token = data ? await tokenDaConta(data as ContaAnuncio) : undefined;
  if (!token) return NextResponse.json({ paginas: [], instagram: [], pixels: [], erro: "Sem token para esta conta (reconecte o Facebook)." });
  return NextResponse.json(await ativosDaConta(contaId, token));
}
