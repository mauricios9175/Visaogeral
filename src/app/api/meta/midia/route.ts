import { NextResponse, type NextRequest } from "next/server";
import { db, type ContaAnuncio } from "@/lib/db";
import { bibliotecaDaConta, fonteDoVideo, FORMATOS_PREVIA, previaDoAnuncio, subirImagem } from "@/lib/meta-montar";
import { apagar } from "@/lib/armazenamento";
import { tokenDaConta } from "@/lib/sync";

export const maxDuration = 60;

async function tokenDe(contaId: string) {
  const { data } = await db().from("contas_anuncio").select("*").eq("id", contaId).maybeSingle();
  return data ? tokenDaConta(data as ContaAnuncio) : undefined;
}

// Mídia da conta do Meta (protegido pelo login do painel):
//   GET ?conta&acao=lista&tipo=video|imagem&depois=…   → biblioteca da conta
//   GET ?conta&acao=fonte&id=<vídeo>                     → link para tocar o vídeo com som
//   GET ?conta&acao=previa&anuncio=<id>&formato=…        → prévia oficial do anúncio (iframe do Meta)
//   POST { conta, caminho }                              → manda uma imagem do Storage para a biblioteca (devolve o hash)
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const conta = q.get("conta") ?? "";
  const token = await tokenDe(conta);
  if (!token) return NextResponse.json({ erro: "Sem token para esta conta (reconecte o Facebook)." });
  try {
    switch (q.get("acao")) {
      case "lista":
        return NextResponse.json(await bibliotecaDaConta(conta, token, q.get("tipo") === "imagem" ? "imagem" : "video", q.get("depois")));
      case "fonte":
        return NextResponse.json(await fonteDoVideo(q.get("id") ?? "", token));
      case "previa": {
        const f = q.get("formato") ?? "MOBILE_FEED_STANDARD";
        return NextResponse.json(await previaDoAnuncio(q.get("anuncio") ?? "", token, (f in FORMATOS_PREVIA ? f : "MOBILE_FEED_STANDARD") as keyof typeof FORMATOS_PREVIA));
      }
      default:
        return NextResponse.json({ erro: "ação inválida" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) });
  }
}

export async function POST(request: NextRequest) {
  const corpo = await request.json().catch(() => ({}));
  const token = await tokenDe(String(corpo.conta ?? ""));
  if (!token) return NextResponse.json({ erro: "Sem token para esta conta." });
  try {
    const hash = await subirImagem(String(corpo.conta), token, String(corpo.caminho ?? ""));
    await apagar([String(corpo.caminho)]).catch(() => null);
    return NextResponse.json({ hash });
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) });
  }
}
