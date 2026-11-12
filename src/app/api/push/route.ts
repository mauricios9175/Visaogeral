import { NextResponse, type NextRequest } from "next/server";
import { chavesPush, enviarParaTodos, inscrever, remover } from "@/lib/push";
import { enviarBomDia, salvarConfigBomDia } from "@/lib/bom-dia";

// Notificações no celular (protegido pelo login do painel):
//   GET                          → { chave } pública para o navegador se inscrever
//   POST { inscricao, aparelho } → guarda o aparelho
//   POST { teste: true }         → manda uma notificação de teste para todos os aparelhos
//   POST { bomDiaTeste: true }   → manda o bom dia de hoje agora (para ver como fica)
//   POST { bomDia: { ligado, hora } } → liga/desliga e muda o horário do bom dia
//   DELETE { endpoint }          → tira o aparelho
export async function GET() {
  try {
    return NextResponse.json({ chave: (await chavesPush()).publicKey });
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const corpo = await request.json().catch(() => ({}));
  try {
    if (corpo.bomDiaTeste) return NextResponse.json(await enviarBomDia(true));
    if (corpo.bomDia) return NextResponse.json({ bomDia: await salvarConfigBomDia(corpo.bomDia) });
    if (corpo.teste) {
      const r = await enviarParaTodos({ titulo: "Visão Geral", corpo: "Notificações ligadas. Os alertas importantes vão chegar aqui.", url: "/" });
      return NextResponse.json(r);
    }
    if (!corpo.inscricao?.endpoint) throw new Error("inscrição inválida");
    await inscrever(corpo.inscricao, String(corpo.aparelho ?? "").slice(0, 120) || null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const corpo = await request.json().catch(() => ({}));
  if (corpo.endpoint) await remover(String(corpo.endpoint));
  return NextResponse.json({ ok: true });
}
