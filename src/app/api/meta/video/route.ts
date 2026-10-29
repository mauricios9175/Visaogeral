import { NextResponse, type NextRequest } from "next/server";
import { db, type ContaAnuncio } from "@/lib/db";
import { tokenDaConta } from "@/lib/sync";
import { concluirEnvioVideo, enviarParteVideo, iniciarEnvioVideo } from "@/lib/meta-montar";

export const maxDuration = 60;

// Vídeo da montagem enviado em partes direto para o Meta (o Storage do Supabase limita o arquivo a 50 MB).
// Protegido pelo login do painel (proxy.ts). O token do Meta fica no servidor.
//   POST ?etapa=inicio&conta=&tamanho=          → { sessao, videoId, inicio, fim }
//   POST ?etapa=parte&conta=&sessao=&inicio=    (corpo = bytes do pedaço) → { inicio, fim }
//   POST ?etapa=fim&conta=&sessao=&nome=        → { ok }
export async function POST(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  try {
    const { data } = await db().from("contas_anuncio").select("*").eq("id", q.get("conta") ?? "").maybeSingle();
    if (!data) throw new Error("Conta não encontrada.");
    const token = await tokenDaConta(data as ContaAnuncio);
    if (!token) throw new Error("Sem token para esta conta (reconecte o Facebook em Configurações).");
    const conta = (data as ContaAnuncio).id;
    switch (q.get("etapa")) {
      case "inicio":
        return NextResponse.json(await iniciarEnvioVideo(conta, token, Number(q.get("tamanho"))));
      case "parte":
        return NextResponse.json(await enviarParteVideo(conta, token, String(q.get("sessao")), Number(q.get("inicio")), await request.blob()));
      case "fim":
        await concluirEnvioVideo(conta, token, String(q.get("sessao")), String(q.get("nome") ?? "vídeo"));
        return NextResponse.json({ ok: true });
      default:
        throw new Error("etapa inválida");
    }
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
