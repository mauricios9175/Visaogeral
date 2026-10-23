import { NextResponse, type NextRequest } from "next/server";
import { db, type ContaAnuncio } from "@/lib/db";
import { buscarInteresses, buscarLocais } from "@/lib/meta-montar";
import { tokenDaConta } from "@/lib/sync";

/**
 * Token (e conta) para as buscas de segmentação: a conta informada; senão a primeira conta com token conectado.
 * A busca completa de segmentação detalhada é feita pela conta de anúncio.
 */
async function tokenParaBusca(contaId: string | null): Promise<{ token?: string; conta: string | null }> {
  const banco = db();
  const { data } = contaId
    ? await banco.from("contas_anuncio").select("*").eq("id", contaId).limit(1)
    : await banco.from("contas_anuncio").select("*").not("cliente_id", "is", null).eq("status", 1).limit(5);
  for (const c of (data ?? []) as ContaAnuncio[]) {
    const t = await tokenDaConta(c);
    if (t) return { token: t, conta: c.id };
  }
  if (process.env.META_SYSTEM_USER_TOKEN) return { token: process.env.META_SYSTEM_USER_TOKEN, conta: null };
  const { data: t } = await banco.from("tokens_meta").select("token").limit(1).maybeSingle();
  return { token: t?.token as string | undefined, conta: null };
}

// Busca de cidades/estados e de interesses para a segmentação dos modelos (protegida pelo login do painel).
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const termo = (q.get("q") ?? "").trim();
  if (termo.length < 2) return NextResponse.json({ itens: [] });
  try {
    const { token, conta } = await tokenParaBusca(q.get("conta"));
    if (!token) throw new Error("Conecte o Facebook em Configurações.");
    const itens = q.get("tipo") === "interesse" ? await buscarInteresses(termo, token, conta) : await buscarLocais(termo, token);
    return NextResponse.json({ itens });
  } catch (e) {
    return NextResponse.json({ itens: [], erro: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}
