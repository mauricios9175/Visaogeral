import { NextResponse, type NextRequest } from "next/server";
import { buscarInteresses, buscarLocais, sugerirInteresses } from "@/lib/meta-montar";
import { tokenParaBusca } from "@/lib/token-busca";

// Busca de cidades/estados e de interesses para a segmentação dos modelos (protegida pelo login do painel).
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const termo = (q.get("q") ?? "").trim();
  const sugestao = q.get("tipo") === "sugestao";
  if (!sugestao && termo.length < 2) return NextResponse.json({ itens: [] });
  try {
    const { token, conta } = await tokenParaBusca(q.get("conta"));
    if (!token) throw new Error("Conecte o Facebook em Configurações.");
    // sugestões parecidas com os itens já escolhidos (?tipo=sugestao&itens=[{id,nome,tipo}])
    if (sugestao) return NextResponse.json({ itens: await sugerirInteresses(JSON.parse(q.get("itens") ?? "[]"), token, conta) });
    const itens = q.get("tipo") === "interesse" ? await buscarInteresses(termo, token, conta) : await buscarLocais(termo, token);
    return NextResponse.json({ itens });
  } catch (e) {
    return NextResponse.json({ itens: [], erro: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}
