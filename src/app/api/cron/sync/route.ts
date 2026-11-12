import { NextResponse, type NextRequest } from "next/server";
import { sincronizar, type ModoSync } from "@/lib/sync";
import { sincronizarCrms } from "@/lib/crm/sync";
import { sincronizarGoogle } from "@/lib/sync-google";
import { atualizarHistoricoRecente } from "@/lib/historico";
import { enviarAvisos } from "@/lib/push";
import { rodadaAutomaticaSugestoes } from "@/lib/sugestoes-auto";
import { analisarCriativosPendentes } from "@/lib/analise-criativo";
import { gerarRadar } from "@/lib/radar";

export const maxDuration = 300;

// Chamado pelo agendador (GitHub Actions) com: Authorization: Bearer <CRON_SECRET>
// ?modo=hoje (a cada hora) | semana (toda madrugada) | mes (manual, recarrega 30 dias) — Meta Ads
// ?modo=crm&dias=30 — CRM de todos os clientes ativos (chamada separada para não estourar o tempo)
// ?modo=google&dias=2 — Google Ads (a cada 3 horas; 30 dias de madrugada)
// ?modo=avisos — notificações no celular com os alertas novos (de hora em hora, depois do Meta)
// ?modo=sugestoes — sugestões com IA nos clientes com sinal de problema (de madrugada; repetir enquanto restantes > 0)
// ?modo=criativos — análise com IA dos criativos ainda sem análise (de madrugada; repetir enquanto restantes > 0)
// ?modo=radar — radar de criativos do dia (melhores por nicho, buscas na Biblioteca e pesquisa)
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
  if (modo === "avisos") return NextResponse.json(await enviarAvisos());
  if (modo === "sugestoes") return NextResponse.json(await rodadaAutomaticaSugestoes());
  if (modo === "criativos") return NextResponse.json(await analisarCriativosPendentes());
  if (modo === "radar") {
    // seNecessario=1: só monta se o radar de hoje ainda não está pronto (o agendador chama a cada execução)
    const r = await gerarRadar({ seNecessario: request.nextUrl.searchParams.get("seNecessario") === "1" });
    return NextResponse.json({ data: r.data, nichos: r.nichos.length, feitoAgora: r.feitoAgora, restantes: r.pendentes?.length ?? 0 });
  }
  if (modo === "google") {
    const dias = Math.min(Number(request.nextUrl.searchParams.get("dias")) || 2, 90);
    return NextResponse.json(await sincronizarGoogle(dias));
  }
  if (!["hoje", "semana", "mes"].includes(modo)) {
    return NextResponse.json({ erro: "modo inválido" }, { status: 400 });
  }
  return NextResponse.json(await sincronizar(modo as ModoSync));
}
