import "server-only";
import { db } from "./db";
import { hojeISO } from "./datas";
import { alertasContas } from "./consultas";
import { calcularAlertas } from "./alertas";
import { listarTarefas } from "./tarefas";
import { contasAgenda, proximosEventos, type Evento } from "./agenda";
import { enviarParaTodos } from "./push";

// "Bom dia" no celular: uma notificação por dia, de manhã, com o resumo do dia
// (reuniões, tarefas, contas com saldo/problema e os clientes que mais pedem atenção).
// Disparado pela rotina de avisos (a cada execução do agendador): manda uma vez, na primeira execução depois do horário.

export type ConfigBomDia = { ligado: boolean; hora: number }; // hora de Brasília (0–23)
const PADRAO: ConfigBomDia = { ligado: true, hora: 8 };
const ATE_HORA = 13; // depois disso não manda mais o do dia (já não é "bom dia")

export async function lerConfigBomDia(): Promise<ConfigBomDia> {
  const { data } = await db().from("configuracoes").select("valor").eq("chave", "bom_dia").maybeSingle();
  return { ...PADRAO, ...((data?.valor as Partial<ConfigBomDia>) ?? {}) };
}

export async function salvarConfigBomDia(c: ConfigBomDia) {
  const valor = { ligado: !!c.ligado, hora: Math.max(5, Math.min(12, Math.round(c.hora) || 8)) };
  await db().from("configuracoes").upsert({ chave: "bom_dia", valor, atualizado_em: new Date().toISOString() });
  return valor;
}

const horaBrasilia = () => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(new Date()));
const horaBR = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Monta o texto do bom dia (título curto e até 4 linhas, que é o que cabe na notificação). */
export async function montarBomDia(): Promise<{ titulo: string; corpo: string; url: string }> {
  const hoje = hojeISO();
  const [tarefas, contas, alertas, eventos] = await Promise.all([
    listarTarefas().catch(() => []),
    alertasContas().catch(() => []),
    calcularAlertas().catch(() => []),
    contasAgenda().then((c) => (c.length ? proximosEventos(1).catch(() => [] as Evento[]) : ([] as Evento[]))),
  ]);
  const abertas = tarefas.filter((t) => !t.feita && !t.aguardando);
  const atrasadas = abertas.filter((t) => t.data < hoje).length;
  const deHoje = abertas.filter((t) => t.data === hoje).length;
  const cobrar = tarefas.filter((t) => !t.feita && t.aguardando && t.data <= hoje).length;
  const diaDe = (e: Evento) => (e.diaInteiro ? e.inicio : new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(e.inicio)));
  const reunioes = eventos.filter((e) => diaDe(e) === hoje && !e.diaInteiro);

  // clientes que mais pedem atenção: alertas críticos de desempenho, depois os de atenção
  const peso = new Map<string, number>();
  for (const a of alertas) if (a.nivel !== "oportunidade") peso.set(a.clienteNome, (peso.get(a.clienteNome) ?? 0) + (a.nivel === "critico" ? 2 : 1));
  const atencao = [...peso.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);

  const partesTitulo = [
    plural(deHoje + atrasadas, "tarefa", "tarefas"),
    reunioes.length ? plural(reunioes.length, "reunião", "reuniões") : null,
  ].filter(Boolean);
  const linhas: string[] = [];
  if (reunioes.length) linhas.push(`📅 ${reunioes.slice(0, 2).map((e) => `${horaBR(e.inicio)} ${e.titulo}`).join(" · ")}${reunioes.length > 2 ? ` +${reunioes.length - 2}` : ""}`);
  if (atrasadas || cobrar) linhas.push(`✅ ${[atrasadas ? `${atrasadas} atrasada${atrasadas > 1 ? "s" : ""}` : null, cobrar ? `${cobrar} para cobrar do cliente` : null].filter(Boolean).join(" · ")}`);
  if (contas.length) linhas.push(`💳 ${contas.slice(0, 2).map((a) => `${a.clienteNome}: ${a.mensagem}`).join(" · ")}${contas.length > 2 ? ` +${contas.length - 2}` : ""}`);
  if (atencao.length) linhas.push(`⚠️ Atenção: ${atencao.join(", ")}`);
  if (!linhas.length) linhas.push("Nada urgente hoje. Bom dia de trabalho!");
  return { titulo: `☀️ Bom dia! Hoje: ${partesTitulo.join(" e ")}`, corpo: linhas.slice(0, 4).join("\n"), url: "/tarefas" };
}

/** Manda o bom dia se já passou do horário e ainda não foi mandado hoje. `forcar`: manda agora (teste). */
export async function enviarBomDia(forcar = false) {
  const banco = db();
  const config = await lerConfigBomDia();
  if (!forcar) {
    if (!config.ligado) return { enviado: false, motivo: "desligado" };
    const h = horaBrasilia();
    if (h < config.hora || h >= ATE_HORA) return { enviado: false, motivo: "fora do horário" };
    const { data: ja } = await banco.from("push_enviados").select("chave").eq("chave", `${hojeISO()}|bomdia`).maybeSingle();
    if (ja) return { enviado: false, motivo: "já enviado hoje" };
  }
  const aviso = await montarBomDia();
  const r = await enviarParaTodos({ ...aviso, tag: `bomdia|${hojeISO()}` });
  if (!forcar) await banco.from("push_enviados").upsert({ chave: `${hojeISO()}|bomdia` });
  return { enviado: true, ...r };
}
