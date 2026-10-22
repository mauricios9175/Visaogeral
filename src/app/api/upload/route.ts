import { NextResponse, type NextRequest } from "next/server";
import { novoCaminho, urlDeEnvio } from "@/lib/armazenamento";

const TIPOS = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|quicktime|webm|x-m4v))$/;

// Prepara o envio de um criativo do computador: devolve a URL para o navegador mandar o arquivo direto ao Storage.
// Protegida pelo login do painel (proxy.ts).
export async function POST(request: NextRequest) {
  const { nome, tipo, lote } = (await request.json()) as { nome?: string; tipo?: string; lote?: string };
  if (!nome || !tipo || !TIPOS.test(tipo) || !/^[\w-]{8,40}$/.test(lote ?? "")) {
    return NextResponse.json({ erro: "Use imagens (JPG, PNG, WEBP) ou vídeos (MP4, MOV)." }, { status: 400 });
  }
  try {
    const caminho = novoCaminho(lote!, nome);
    return NextResponse.json({ caminho, url: await urlDeEnvio(caminho) });
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
