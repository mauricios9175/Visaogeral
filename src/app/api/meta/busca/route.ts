import { NextResponse, type NextRequest } from "next/server";
import { db, type ContaAnuncio } from "@/lib/db";
import { buscarInteresses, buscarLocais } from "@/lib/meta-montar";
import { tokenDaConta } from "@/lib/sync";

/** Token para buscas de segmentação: o da conta, se informada; senão qualquer token conectado. */
async function tokenParaBusca(contaId: string | null) {
  if (contaId) {
    const { data } = await db().from("contas_anuncio").select("*").eq("id", contaId).maybeSingle();
    if (data) {
      const t = await tokenDaConta(data as ContaAnuncio);
      if (t) return t;
    }
  }
  if (process.env.META_SYSTEM_USER_TOKEN) return process.env.META_SYSTEM_USER_TOKEN;
  const { data } = await db().from("tokens_meta").select("token").limit(1).maybeSingle();
  return data?.token as string | undefined;
}

// Busca de cidades/estados e de interesses para a segmentação dos modelos (protegida pelo login do painel).
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const termo = (q.get("q") ?? "").trim();
  if (termo.length < 2) return NextResponse.json({ itens: [] });
  try {
    const token = await tokenParaBusca(q.get("conta"));
    if (!token) throw new Error("Conecte o Facebook em Configurações.");
    const itens = q.get("tipo") === "interesse" ? await buscarInteresses(termo, token) : await buscarLocais(termo, token);
    return NextResponse.json({ itens });
  } catch (e) {
    return NextResponse.json({ itens: [], erro: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}
