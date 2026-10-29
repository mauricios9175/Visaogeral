import { NextResponse, type NextRequest } from "next/server";
import { db, type ContaAnuncio } from "@/lib/db";
import { tokenDaConta } from "@/lib/sync";
import { concluirEnvioVideo, enviarParteVideo, iniciarEnvioVideo } from "@/lib/meta-montar";
import { apagar, baixar, guardarParte } from "@/lib/armazenamento";

export const maxDuration = 120;

// Vídeo da montagem enviado em partes direto para o Meta (o Storage do Supabase limita o arquivo a 50 MB).
// Protegido pelo login do painel (proxy.ts). O token do Meta fica no servidor.
//   POST ?etapa=inicio&conta=&tamanho=          → { sessao, videoId, inicio, fim }
//   POST ?etapa=parte&conta=&sessao=&inicio=&n=&total=  (corpo = até 4 MB do trecho pedido pelo Meta)
//        A Vercel só aceita ~4,5 MB por chamada e o Meta pede trechos maiores: os pedaços ficam no Storage
//        e, no último (n = total - 1), o trecho é montado e enviado ao Meta → { inicio, fim }; antes disso → { guardado }
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
      case "parte": {
        const sessao = String(q.get("sessao"));
        const inicio = Number(q.get("inicio"));
        const n = Number(q.get("n") ?? 0), total = Number(q.get("total") ?? 1);
        const pasta = `envios-video/${sessao.replace(/\W/g, "")}/${inicio}`;
        const corpo = await request.blob();
        if (n < total - 1) {
          await guardarParte(`${pasta}/${n}`, corpo);
          return NextResponse.json({ guardado: n });
        }
        const anteriores = Array.from({ length: total - 1 }, (_, i) => `${pasta}/${i}`);
        const pedacos = await Promise.all(anteriores.map((c) => baixar(c)));
        const trecho = new Blob([...pedacos, corpo]);
        const r = await enviarParteVideo(conta, token, sessao, inicio, trecho);
        await apagar(anteriores);
        return NextResponse.json(r);
      }
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
