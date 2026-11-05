import { NextResponse, type NextRequest } from "next/server";
import { esbocarAnuncioGoogle, esbocarCampanha, esbocarGoogle } from "@/lib/esboco";

export const maxDuration = 120;

// Esboço de campanha com IA (protegido pelo login do painel):
//   { pedido, clienteId?, contaId?, plataforma?: "meta" | "google" } → configuração pronta para revisar
// Sem clienteId: é um modelo (vale para qualquer cliente).
export async function POST(request: NextRequest) {
  const corpo = await request.json().catch(() => ({}));
  const pedido = typeof corpo.pedido === "string" ? corpo.pedido.trim().slice(0, 1000) : "";
  const lista = (v: unknown) => (Array.isArray(v) ? v.map(String).slice(0, 60) : []);
  // anúncio novo para um grupo do Google: { plataforma: "google-anuncio", grupo, palavras[], atuais[], pedido? }
  if (corpo.plataforma === "google-anuncio") {
    try {
      return NextResponse.json(await esbocarAnuncioGoogle(typeof corpo.clienteId === "string" ? corpo.clienteId : null, String(corpo.grupo ?? "").slice(0, 200), lista(corpo.palavras), lista(corpo.atuais), pedido));
    } catch (e) {
      return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }
  if (!pedido) return NextResponse.json({ erro: "Escreva o que a campanha precisa ter." }, { status: 400 });
  const clienteId = typeof corpo.clienteId === "string" && corpo.clienteId ? corpo.clienteId : null;
  try {
    if (corpo.plataforma === "google") return NextResponse.json(await esbocarGoogle(clienteId, pedido));
    return NextResponse.json(await esbocarCampanha(clienteId, pedido, typeof corpo.contaId === "string" ? corpo.contaId : null));
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
