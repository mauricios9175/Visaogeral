import { NextResponse, type NextRequest } from "next/server";
import { sincronizar, type ModoSync } from "@/lib/sync";

export const maxDuration = 300;

// Chamado pelo agendador (GitHub Actions) com: Authorization: Bearer <CRON_SECRET>
// ?modo=hoje (a cada hora) | semana (toda madrugada) | mes (manual, recarrega 30 dias)
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || request.headers.get("authorization") !== `Bearer ${segredo}`) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }
  const modo = (request.nextUrl.searchParams.get("modo") ?? "hoje") as ModoSync;
  if (!["hoje", "semana", "mes"].includes(modo)) {
    return NextResponse.json({ erro: "modo inválido" }, { status: 400 });
  }
  const resultado = await sincronizar(modo);
  return NextResponse.json(resultado);
}
