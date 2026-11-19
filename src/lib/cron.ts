import "server-only";
import { db } from "./db";
import { sincronizar, type ModoSync } from "./sync";
import { sincronizarCrms } from "./crm/sync";
import { sincronizarGoogle } from "./sync-google";
import { atualizarHistoricoRecente } from "./historico";
import { enviarAvisos } from "./push";
import { rodadaAutomaticaSugestoes } from "./sugestoes-auto";
import { analisarCriativosPendentes } from "./analise-criativo";
import { gerarRadar } from "./radar";
import { processarFilaHistorico } from "./historico-contas";

// As tarefas automáticas do painel (chamadas pelo agendador externo, de hora em hora, ou à mão).
// Cada tarefa registra a última execução (para a tela de Configurações mostrar se o agendador está funcionando).

export type Tarefa = { modo: string; params?: Record<string, string> };

export const TAREFAS_VALIDAS = ["hoje", "semana", "mes", "crm", "google", "avisos", "sugestoes", "criativos", "radar", "historico", "historico_contas"];

/** Tarefas que fazem uma parte por vez (devolvem "restantes"): o agendador chama de novo até acabar. */
export const REPETEM = new Set(["sugestoes", "criativos", "radar", "historico_contas"]);

export async function executarTarefa(t: Tarefa): Promise<Record<string, unknown>> {
  const p = t.params ?? {};
  switch (t.modo) {
    case "crm": return sincronizarCrms(Math.min(Number(p.dias) || 30, 180)) as unknown as Record<string, unknown>;
    case "historico": return (await atualizarHistoricoRecente()) as unknown as Record<string, unknown>;
    case "historico_contas": return (await processarFilaHistorico()) as unknown as Record<string, unknown>;
    case "avisos": return (await enviarAvisos()) as unknown as Record<string, unknown>;
    case "sugestoes": return (await rodadaAutomaticaSugestoes()) as unknown as Record<string, unknown>;
    case "criativos": return (await analisarCriativosPendentes()) as unknown as Record<string, unknown>;
    case "radar": {
      const r = await gerarRadar({ seNecessario: p.seNecessario === "1" });
      return { data: r.data, nichos: r.nichos.length, feitoAgora: r.feitoAgora, restantes: r.pendentes?.length ?? 0 };
    }
    case "google": return (await sincronizarGoogle(Math.min(Number(p.dias) || 2, 90))) as unknown as Record<string, unknown>;
    case "hoje": case "semana": case "mes": return (await sincronizar(t.modo as ModoSync)) as unknown as Record<string, unknown>;
    default: throw new Error(`tarefa inválida: ${t.modo}`);
  }
}

/** Guarda o resultado da última execução de cada tarefa (configuracoes "cron:<modo>"). */
export async function registrarTarefa(modo: string, r: { ok: boolean; resultado?: unknown; erro?: string; inicio: number }) {
  const valor = {
    ok: r.ok, em: new Date().toISOString(), segundos: Math.round((Date.now() - r.inicio) / 1000),
    ...(r.erro ? { erro: r.erro.slice(0, 500) } : { resultado: JSON.parse(JSON.stringify(r.resultado ?? null)) }),
  };
  await db().from("configuracoes").upsert({ chave: `cron:${modo}`, valor, atualizado_em: valor.em }).then(() => null, () => null);
}

export async function ultimasTarefas(): Promise<{ modo: string; ok: boolean; em: string; segundos: number; erro?: string; resultado?: unknown }[]> {
  const { data } = await db().from("configuracoes").select("chave, valor").like("chave", "cron:%");
  return ((data ?? []) as { chave: string; valor: { ok: boolean; em: string; segundos: number; erro?: string; resultado?: unknown } }[])
    .map((x) => ({ modo: x.chave.slice(5), ...x.valor }))
    .sort((a, b) => b.em.localeCompare(a.em));
}

/**
 * O que rodar nesta hora (horário de Brasília). De hora em hora: Meta de hoje, CRM, avisos (e o bom dia), radar
 * (se ainda não está pronto) e um lote de análise de criativos. A cada 3 horas: Google. Às 3h da manhã: a rodada
 * da madrugada (Meta 7 dias, Google 30 dias, CRM 90 dias, histórico, sugestões da IA e mais análise de criativos).
 */
export function tarefasDaHora(hora: number): Tarefa[] {
  if (hora === 3) {
    return [
      { modo: "semana" }, { modo: "google", params: { dias: "30" } }, { modo: "crm", params: { dias: "90" } },
      { modo: "historico" }, { modo: "historico_contas" }, { modo: "sugestoes" }, { modo: "criativos" }, { modo: "avisos" }, { modo: "radar", params: { seNecessario: "1" } },
    ];
  }
  return [
    { modo: "hoje" }, { modo: "crm", params: { dias: "30" } }, { modo: "avisos" }, { modo: "historico_contas" },
    // de hora em hora, só um lote de criativos (uma=1: não se chama de novo; a fila grande anda de madrugada)
    { modo: "radar", params: { seNecessario: "1" } }, { modo: "criativos", params: { uma: "1" } },
    ...(hora % 3 === 0 ? [{ modo: "google", params: { dias: "2" } }] : []),
  ];
}
