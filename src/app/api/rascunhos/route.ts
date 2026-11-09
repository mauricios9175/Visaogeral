import { NextResponse, type NextRequest } from "next/server";
import { excluirRascunho, lerRascunho, salvarRascunho, type Rascunho } from "@/lib/rascunhos";

// Rascunhos de campanha (protegido pelo login do painel):
//   POST { rascunho, criar? }    → salva (a tela de montagem salva sozinha); sem criar, só atualiza o que existe
//   DELETE { clienteId, id }     → exclui
export async function POST(request: NextRequest) {
  const corpo = await request.json().catch(() => ({}));
  const r = corpo.rascunho as Rascunho | undefined;
  if (!r?.id || !r.clienteId) return NextResponse.json({ erro: "rascunho inválido" }, { status: 400 });
  try {
    // não deixa trocar o cliente nem a origem de um rascunho que já existe
    const atual = await lerRascunho(r.clienteId, r.id);
    // salvamento automático de um rascunho que já foi publicado/excluído: não recria
    if (!atual && !corpo.criar) return NextResponse.json({ ok: false, naoExiste: true });
    const salvo = await salvarRascunho({ ...(atual ?? {}), ...r, criadoEm: atual?.criadoEm ?? r.criadoEm ?? new Date().toISOString() });
    return NextResponse.json({ ok: true, atualizadoEm: salvo.atualizadoEm });
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const corpo = await request.json().catch(() => ({}));
  if (typeof corpo.clienteId !== "string" || typeof corpo.id !== "string") return NextResponse.json({ erro: "inválido" }, { status: 400 });
  await excluirRascunho(corpo.clienteId, corpo.id);
  return NextResponse.json({ ok: true });
}
