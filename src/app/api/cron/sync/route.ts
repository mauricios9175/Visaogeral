import { after, NextResponse, type NextRequest } from "next/server";
import { executarTarefa, registrarTarefa, REPETEM, TAREFAS_VALIDAS } from "@/lib/cron";

export const maxDuration = 300;

// Uma tarefa automática. Authorization: Bearer <CRON_SECRET>
// ?modo=hoje | semana | mes (Meta) · crm&dias=30 · google&dias=2 · avisos · sugestoes · criativos · radar&seNecessario=1 · historico
// &fundo=1: responde na hora (202) e faz o trabalho depois (para agendadores que só esperam uns segundos);
//   as tarefas que fazem uma parte por vez (sugestões, criativos, radar) se chamam de novo até acabar (até 6 vezes).
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || request.headers.get("authorization") !== `Bearer ${segredo}`) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }
  const q = request.nextUrl.searchParams;
  const modo = q.get("modo") ?? "hoje";
  if (!TAREFAS_VALIDAS.includes(modo)) return NextResponse.json({ erro: "modo inválido" }, { status: 400 });
  const params = Object.fromEntries([...q.entries()].filter(([k]) => !["modo", "fundo", "vez"].includes(k)));
  const tarefa = { modo, params };

  if (q.get("fundo") !== "1") {
    const inicio = Date.now();
    try {
      const r = await executarTarefa(tarefa);
      await registrarTarefa(modo, { ok: true, resultado: r, inicio });
      return NextResponse.json(r);
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e);
      await registrarTarefa(modo, { ok: false, erro, inicio });
      return NextResponse.json({ erro }, { status: 500 });
    }
  }

  // em segundo plano: responde já e trabalha depois
  const vez = Number(q.get("vez")) || 1;
  const origem = request.nextUrl.origin;
  after(async () => {
    const inicio = Date.now();
    try {
      const r = await executarTarefa(tarefa);
      await registrarTarefa(modo, { ok: true, resultado: r, inicio });
      // ainda tem o que fazer (e a IA não está no limite): chama de novo, numa execução nova
      const falta = Number((r as { restantes?: number }).restantes ?? 0) > 0;
      const limite = /limite/i.test(JSON.stringify((r as { erros?: unknown }).erros ?? ""));
      if (REPETEM.has(modo) && params.uma !== "1" && falta && !limite && vez < 6) {
        const prox = new URL("/api/cron/sync", origem);
        for (const [k, v] of Object.entries({ ...params, modo, fundo: "1", vez: String(vez + 1) })) prox.searchParams.set(k, v);
        await fetch(prox, { headers: { authorization: `Bearer ${segredo}` }, signal: AbortSignal.timeout(20_000) }).catch(() => null);
      }
    } catch (e) {
      await registrarTarefa(modo, { ok: false, erro: e instanceof Error ? e.message : String(e), inicio });
    }
  });
  return NextResponse.json({ aceito: true, modo, vez }, { status: 202 });
}
