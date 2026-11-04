import "server-only";
import { calcularAlertas } from "./alertas";
import { hojeISO } from "./datas";
import { enviarParaTodos } from "./push";
import { lerHistoricoSugestoes, sugerirOtimizacoes, type PlataformaIA } from "./sugestoes";

// Rodada automática das sugestões com IA (de madrugada): só nos clientes com algum sinal de problema nos alertas
// (crítico ou atenção), na plataforma do sinal. Cada chamada processa o que couber no tempo; repetir até `restantes` = 0.
// No fim, uma notificação no celular com o resumo.

const TEMPO_MAX_MS = 200_000; // a rota tem 300 s; cada cliente leva uns 20 a 40 s
const MAX_POR_NOITE = 12;     // cuidado com o limite gratuito da IA

const diaSP = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));

export async function rodadaAutomaticaSugestoes() {
  const inicio = Date.now();
  const hoje = hojeISO();
  const alertas = (await calcularAlertas()).filter((a) => a.nivel === "critico" || a.nivel === "atencao");
  // cliente + plataforma com sinal (alertas do Google começam com "Google ·")
  const fila = new Map<string, { clienteId: string; nome: string; plataforma: PlataformaIA; sinais: string[] }>();
  for (const a of alertas) {
    const plataforma: PlataformaIA = a.titulo.startsWith("Google") ? "google" : "meta";
    const k = `${a.clienteId}|${plataforma}`;
    const x = fila.get(k) ?? { clienteId: a.clienteId, nome: a.clienteNome, plataforma, sinais: [] };
    x.sinais.push(a.titulo);
    fila.set(k, x);
  }
  const itens = [...fila.values()].sort((a, b) => b.sinais.length - a.sinais.length).slice(0, MAX_POR_NOITE);

  const feitos: { nome: string; plataforma: PlataformaIA; sugestoes: number; clienteId: string }[] = [];
  const erros: string[] = [];
  let restantes = 0;
  for (const it of itens) {
    // já rodou hoje para este cliente e plataforma (numa chamada anterior desta noite)
    const h = await lerHistoricoSugestoes(it.clienteId).catch(() => []);
    if (h.some((r) => r.automatica && (r.plataforma ?? "meta") === it.plataforma && r.criado_em && diaSP(r.criado_em) === hoje)) continue;
    if (Date.now() - inicio > TEMPO_MAX_MS) { restantes++; continue; }
    try {
      const r = await sugerirOtimizacoes(it.clienteId, { p: "14" }, it.plataforma, { automatica: true, sinais: it.sinais });
      const acoes = r.sugestoes.filter((s) => s.acao !== "manter" && s.acao !== "aguardar").length;
      feitos.push({ nome: it.nome, plataforma: it.plataforma, sugestoes: acoes, clienteId: it.clienteId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      erros.push(`${it.nome} (${it.plataforma}): ${msg}`);
      // limite da IA: para por hoje
      if (/limite|sobrecarregad/i.test(msg)) break;
    }
  }

  const comAcao = feitos.filter((f) => f.sugestoes > 0);
  if (comAcao.length) {
    const total = comAcao.reduce((t, f) => t + f.sugestoes, 0);
    await enviarParaTodos({
      titulo: `✦ ${total} sugestão(ões) da IA`,
      corpo: comAcao.slice(0, 4).map((f) => `${f.nome}${f.plataforma === "google" ? " (Google)" : ""}: ${f.sugestoes}`).join(" · ") +
        (comAcao.length > 4 ? ` e mais ${comAcao.length - 4}` : "") + ". Toque para ver.",
      url: comAcao.length === 1 ? `/clientes/${comAcao[0].clienteId}#sugestoes` : "/alertas#ia",
      tag: `sugestoes|${hoje}|${feitos.length}`,
    }).catch(() => null);
  }
  return { analisados: feitos.length, comAcao: comAcao.length, restantes, erros };
}
