import "server-only";
import { db, EMPRESA_PADRAO } from "./db";
import { hojeISO, somarDias } from "./datas";
import { alertasContas } from "./consultas";
import { lerDescartadas, type Tarefa } from "./tarefas";
import { chaveEmpresa, listarEmpresas } from "./empresas";
import type { ResultadoSugestoes } from "./sugestoes";

// Tarefas que o Dash sugere sozinho: você aceita (vira tarefa) ou descarta. Cada sugestão tem uma chave com a
// semana ou o mês, então, se o problema continuar, ela volta na semana/mês seguinte.

export type SugestaoTarefa = {
  chave: string;
  titulo: string;
  clienteId: string;
  motivo: string;
  link: string;
  tipo: "conta" | "ia" | "relatorio" | "revisar";
};

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const DIAS_SEM_ACAO = 14;
const MAX_REVISAR = 5;
const DIA_LIMITE_RELATORIO = 7; // sugere o relatório do mês passado até o dia 7

/** Segunda-feira da semana (chave das sugestões semanais). */
function semanaDe(iso: string) {
  const dia = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return somarDias(iso, -((dia + 6) % 7));
}


export async function sugestoesDeTarefa(tarefas: Tarefa[]): Promise<SugestaoTarefa[]> {
  const hoje = hojeISO();
  const semana = semanaDe(hoje);
  const banco = db();
  const [{ data: clientesRaw }, descartadas, contas, { data: historicosIA }, { data: acoes }, { data: relatorios }] = await Promise.all([
    banco.from("clientes").select("id, nome, empresa, criado_em").eq("ativo", true),
    lerDescartadas(),
    alertasContas().catch(() => []),
    banco.from("configuracoes").select("chave, valor").like("chave", "ia_sugestoes:%"),
    banco.from("acoes_log").select("cliente_id, criado_em").gte("criado_em", `${somarDias(hoje, -60)}T00:00:00Z`).order("criado_em", { ascending: false }).limit(5000),
    banco.from("relatorios_gerados").select("cliente_id, criado_em").gte("criado_em", `${hoje.slice(0, 8)}01T00:00:00Z`),
  ]);
  const clientes = ((clientesRaw ?? []) as { id: string; nome: string; empresa: string | null; criado_em: string }[])
    .map((c) => ({ ...c, empresa: c.empresa || EMPRESA_PADRAO }));
  const porId = new Map(clientes.map((c) => [c.id, c]));
  const sugestoes: SugestaoTarefa[] = [];

  // 1) saldo e status das contas (o mais urgente)
  for (const a of contas) {
    if (!porId.has(a.clienteId)) continue;
    sugestoes.push({
      chave: `conta:${a.clienteId}:${a.contaNome}:${semana}`, tipo: "conta", clienteId: a.clienteId,
      titulo: `Resolver a conta ${a.contaNome}: ${a.mensagem}`, motivo: a.nivel === "critico" ? "Conta com problema" : "Saldo/conta pedindo atenção",
      link: "/alertas",
    });
  }

  // 2) sugestões da IA desta noite que ainda não foram feitas
  const desde = Date.now() - 36 * 3600_000;
  for (const h of (historicosIA ?? []) as { chave: string; valor: ResultadoSugestoes[] }[]) {
    const clienteId = h.chave.split(":")[1];
    if (!porId.has(clienteId)) continue;
    for (const r of Array.isArray(h.valor) ? h.valor : []) {
      if (!r.automatica || !r.criado_em || Date.parse(r.criado_em) < desde) continue;
      const pendentes = r.sugestoes.length - (r.feitas?.length ?? 0);
      if (pendentes <= 0) continue;
      sugestoes.push({
        chave: `ia:${clienteId}:${r.id ?? r.criado_em}`, tipo: "ia", clienteId,
        titulo: `Ver ${pendentes} sugest${pendentes > 1 ? "ões" : "ão"} da IA${r.plataforma === "google" ? " (Google)" : ""}`,
        motivo: r.sinais?.length ? `Sinais: ${r.sinais.slice(0, 2).join("; ")}` : "Rodada automática da madrugada",
        link: `/clientes/${clienteId}#sugestoes`,
      });
    }
  }

  // 3) relatório do mês passado (Propulsão e clientes próprios), nos primeiros dias do mês
  const diaDoMes = Number(hoje.slice(8, 10));
  if (diaDoMes <= DIA_LIMITE_RELATORIO) {
    const [a, m] = hoje.split("-").map(Number);
    const mesPassado = MESES[(m + 10) % 12];
    const comRelatorio = new Set(((relatorios ?? []) as { cliente_id: string }[]).map((r) => r.cliente_id));
    // empresas sem relatório mensal (configurado em Empresas e relatórios) ficam de fora
    const semMensal = new Set((await listarEmpresas().catch(() => [])).filter((e) => !e.relatorioMensal).map((e) => chaveEmpresa(e.nome)));
    const semRelatorio = (empresa: string) => semMensal.has(chaveEmpresa(empresa));
    for (const c of clientes) {
      if (semRelatorio(c.empresa) || comRelatorio.has(c.id)) continue;
      // cliente que começou neste mês ainda não tem mês passado
      if (c.criado_em && c.criado_em.slice(0, 7) === hoje.slice(0, 7)) continue;
      sugestoes.push({
        chave: `relatorio:${c.id}:${a}-${String(m).padStart(2, "0")}`, tipo: "relatorio", clienteId: c.id,
        titulo: `Enviar o relatório de ${mesPassado}`, motivo: `${c.empresa}: relatório mensal`,
        link: `/clientes/${c.id}/historico#relatorio`,
      });
    }
  }

  // 4) cliente sem nenhuma ação pelo painel há 14 dias e sem tarefa aberta: revisar a conta
  const ultimaAcao = new Map<string, string>();
  for (const x of (acoes ?? []) as { cliente_id: string | null; criado_em: string }[]) {
    if (x.cliente_id && !ultimaAcao.has(x.cliente_id)) ultimaAcao.set(x.cliente_id, x.criado_em);
  }
  const comTarefaAberta = new Set(tarefas.filter((t) => !t.feita && t.clienteId).map((t) => t.clienteId!));
  const ultimaTarefaFeita = new Map<string, string>();
  for (const t of tarefas) {
    if (t.feita && t.clienteId && t.feitaEm && (ultimaTarefaFeita.get(t.clienteId) ?? "") < t.feitaEm) ultimaTarefaFeita.set(t.clienteId, t.feitaEm);
  }
  const limite = `${somarDias(hoje, -DIAS_SEM_ACAO)}`;
  const parados: (SugestaoTarefa & { desde: string })[] = [];
  for (const c of clientes) {
    if (comTarefaAberta.has(c.id)) continue;
    const ultima = [ultimaAcao.get(c.id), ultimaTarefaFeita.get(c.id), c.criado_em].filter(Boolean).sort().at(-1)!;
    if (!ultima || ultima.slice(0, 10) >= limite) continue;
    const dias = Math.round((Date.parse(hoje) - Date.parse(ultima.slice(0, 10))) / 86_400_000);
    parados.push({
      desde: ultima,
      chave: `revisar:${c.id}:${semana}`, tipo: "revisar", clienteId: c.id,
      titulo: "Revisar a conta e otimizar", motivo: dias > 60 ? "Nenhuma ação registrada no painel há mais de 60 dias" : `Nenhuma ação registrada no painel há ${dias} dias`,
      link: `/clientes/${c.id}`,
    });
  }
  // no máximo 5 por semana, os parados há mais tempo primeiro (para não virar uma lista enorme)
  const usadas = new Set(tarefas.map((t) => t.origem).filter(Boolean));
  sugestoes.push(...parados.filter((x) => !descartadas[x.chave] && !usadas.has(x.chave)).sort((a, b) => a.desde.localeCompare(b.desde)).slice(0, MAX_REVISAR).map(({ desde, ...x }) => (void desde, x)));

  // fora o que já virou tarefa ou foi descartado
  const jaTem = new Set(tarefas.map((t) => t.origem).filter(Boolean));
  return sugestoes.filter((s) => !jaTem.has(s.chave) && !descartadas[s.chave]);
}
