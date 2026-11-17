import { NextResponse, type NextRequest } from "next/server";
import { tarefasDaHora } from "@/lib/cron";

export const maxDuration = 60;

// Rodada do agendador externo (um único endereço, chamado de hora em hora). Authorization: Bearer <CRON_SECRET>
// Dispara as tarefas desta hora (horário de Brasília), cada uma numa execução separada e em segundo plano,
// e responde em poucos segundos (agendadores grátis costumam esperar no máximo 30 s).
// ?hora=3 força a rodada de uma hora específica (ex.: rodar a da madrugada à mão).
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || request.headers.get("authorization") !== `Bearer ${segredo}`) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }
  const forcada = request.nextUrl.searchParams.get("hora");
  const hora = forcada && /^\d{1,2}$/.test(forcada)
    ? Number(forcada)
    : Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(new Date()));
  const tarefas = tarefasDaHora(hora);
  const origem = request.nextUrl.origin;
  const disparadas = await Promise.all(tarefas.map(async (t) => {
    const url = new URL("/api/cron/sync", origem);
    for (const [k, v] of Object.entries({ ...(t.params ?? {}), modo: t.modo, fundo: "1" })) url.searchParams.set(k, v);
    const r = await fetch(url, { headers: { authorization: `Bearer ${segredo}` }, signal: AbortSignal.timeout(20_000) }).catch(() => null);
    return { modo: t.modo, ok: r?.status === 202 };
  }));
  return NextResponse.json({ hora, disparadas });
}
