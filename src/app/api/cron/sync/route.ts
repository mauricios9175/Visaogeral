import { NextResponse, type NextRequest } from "next/server";
import { sincronizar, type ModoSync } from "@/lib/sync";
import { sincronizarCrms } from "@/lib/crm/sync";
import { sincronizarGoogle } from "@/lib/sync-google";
import { atualizarHistoricoRecente } from "@/lib/historico";

export const maxDuration = 300;

// Chamado pelo agendador (GitHub Actions) com: Authorization: Bearer <CRON_SECRET>
// ?modo=hoje (a cada hora) | semana (toda madrugada) | mes (manual, recarrega 30 dias) — Meta Ads
// ?modo=crm&dias=30 — CRM de todos os clientes ativos (chamada separada para não estourar o tempo)
// ?modo=google&dias=2 — Google Ads (a cada 3 horas; 30 dias de madrugada)
// ?modo=historico — grava o mês atual (e o anterior até o dia 10) no histórico mensal de cada cliente
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || request.headers.get("authorization") !== `Bearer ${segredo}`) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }
  const modo = request.nextUrl.searchParams.get("modo") ?? "hoje";
  if (modo === "crm") {
    const dias = Math.min(Number(request.nextUrl.searchParams.get("dias")) || 30, 180);
    return NextResponse.json(await sincronizarCrms(dias));
  }
  if (modo === "historico") return NextResponse.json(await atualizarHistoricoRecente());
  if (modo === "google") {
    const dias = Math.min(Number(request.nextUrl.searchParams.get("dias")) || 2, 90);
    return NextResponse.json(await sincronizarGoogle(dias));
  }
  if (!["hoje", "semana", "mes"].includes(modo)) {
    return NextResponse.json({ erro: "modo inválido" }, { status: 400 });
  }
  return NextResponse.json(await sincronizar(modo as ModoSync));
}
