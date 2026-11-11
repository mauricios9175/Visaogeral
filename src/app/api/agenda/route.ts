import { NextResponse, type NextRequest } from "next/server";
import { contaAgenda, marcarReuniao, proximosEventos } from "@/lib/agenda";

// Google Agenda (protegido pelo login do painel).
//   GET ?dias=7&cliente=<id>                 → { conectado, eventos }
//   POST { clienteId?, titulo, inicio: "AAAA-MM-DDTHH:MM", minutos, meet?, convidados?: string[], descricao? } → { evento }
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  try {
    if (!(await contaAgenda())) return NextResponse.json({ conectado: false, eventos: [] });
    const dias = Math.min(Math.max(Number(q.get("dias")) || 7, 1), 60);
    return NextResponse.json({ conectado: true, eventos: await proximosEventos(dias, { clienteId: q.get("cliente") ?? undefined }) });
  } catch (e) {
    return NextResponse.json({ conectado: true, eventos: [], erro: e instanceof Error ? e.message : String(e) });
  }
}

export async function POST(request: NextRequest) {
  const c = await request.json().catch(() => ({}));
  try {
    const evento = await marcarReuniao({
      titulo: String(c.titulo ?? "").trim() || "Reunião",
      inicio: String(c.inicio ?? ""),
      minutos: Number(c.minutos) || 30,
      clienteId: typeof c.clienteId === "string" && c.clienteId ? c.clienteId : null,
      descricao: typeof c.descricao === "string" ? c.descricao : undefined,
      meet: !!c.meet,
      convidados: Array.isArray(c.convidados) ? c.convidados.map(String) : [],
    });
    return NextResponse.json({ evento });
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
