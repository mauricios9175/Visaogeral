import "server-only";
import { db } from "./db";
import { buscarTudo } from "./consultas";
import { hojeISO, somarDias, type Periodo } from "./datas";

export type NumerosGoogle = {
  gasto: number;
  impressoes: number;
  cliques: number;
  conversoes: number;
  valor: number;
  cpa: number | null;
  ctr: number | null;
  cpc: number | null;
  roas: number | null;
};

export type LinhaGoogle = {
  conta_id: string; data: string; campaign_id: string; campaign_nome: string | null; campaign_status: string | null;
  canal: string | null; gasto: number; impressoes: number; cliques: number; conversoes: number; valor_conversoes: number;
  conversoes_acao: Record<string, number> | null;
  orcamento_diario?: number | null; orcamento_compartilhado?: boolean | null;
};

export function somarGoogle(ls: Pick<LinhaGoogle, "gasto" | "impressoes" | "cliques" | "conversoes" | "valor_conversoes">[]): NumerosGoogle {
  const s = ls.reduce(
    (t, l) => ({
      gasto: t.gasto + Number(l.gasto), impressoes: t.impressoes + Number(l.impressoes), cliques: t.cliques + Number(l.cliques),
      conversoes: t.conversoes + Number(l.conversoes), valor: t.valor + Number(l.valor_conversoes),
    }),
    { gasto: 0, impressoes: 0, cliques: 0, conversoes: 0, valor: 0 },
  );
  const div = (a: number, b: number) => (b > 0 ? a / b : null);
  return {
    ...s,
    cpa: div(s.gasto, s.conversoes),
    ctr: div(s.cliques * 100, s.impressoes),
    cpc: div(s.gasto, s.cliques),
    roas: s.valor > 0 ? div(s.valor, s.gasto) : null,
  };
}

/** Contas do Google vinculadas a clientes (id → cliente). Vazio se o SQL 0009 ainda não rodou. */
async function contasPorCliente(clienteId?: string) {
  let q = db().from("contas_google").select("id, nome, cliente_id, ultima_sync, ultimo_erro, gerente_nome").not("cliente_id", "is", null);
  if (clienteId) q = q.eq("cliente_id", clienteId);
  const { data, error } = await q;
  if (error) return [];
  return data as { id: string; nome: string; cliente_id: string; ultima_sync: string | null; ultimo_erro: string | null; gerente_nome: string | null }[];
}

async function linhas(contas: string[], desde: string, ate: string) {
  if (!contas.length) return [];
  return buscarTudo<LinhaGoogle>((de, a) =>
    db().from("metricas_google").select("*").in("conta_id", contas).gte("data", desde).lte("data", ate).range(de, a),
  );
}

/** Totais do Google Ads por cliente, no período e no anterior (para os cards da visão geral). */
export async function resumoGoogle(atual: Periodo, anterior: Periodo) {
  const contas = await contasPorCliente();
  const clienteDaConta = new Map(contas.map((c) => [c.id, c.cliente_id]));
  const todas = await linhas(contas.map((c) => c.id), anterior.desde, atual.ate).catch(() => []);
  const mapa = new Map<string, { atual: NumerosGoogle; anterior: NumerosGoogle }>();
  for (const clienteId of new Set(clienteDaConta.values())) {
    const minhas = todas.filter((l) => clienteDaConta.get(l.conta_id) === clienteId);
    mapa.set(clienteId, {
      atual: somarGoogle(minhas.filter((l) => l.data >= atual.desde && l.data <= atual.ate)),
      anterior: somarGoogle(minhas.filter((l) => l.data >= anterior.desde && l.data <= anterior.ate)),
    });
  }
  return mapa;
}

export type CampanhaGoogle = NumerosGoogle & {
  id: string; nome: string; status: string | null; canal: string | null; conta: string; contaId: string;
  orcamento: number | null; compartilhado: boolean;
};

/** Detalhe do Google Ads de um cliente: totais, série diária, campanhas e conversões por ação. */
export async function detalheGoogle(clienteId: string, atual: Periodo, anterior: Periodo) {
  const contas = await contasPorCliente(clienteId);
  if (!contas.length) return null;
  const todas = await linhas(contas.map((c) => c.id), anterior.desde, atual.ate);
  const doPeriodo = todas.filter((l) => l.data >= atual.desde && l.data <= atual.ate);
  const nomeConta = new Map(contas.map((c) => [c.id, c.nome]));

  const porCampanha = new Map<string, LinhaGoogle[]>();
  for (const l of doPeriodo) porCampanha.set(l.campaign_id, [...(porCampanha.get(l.campaign_id) ?? []), l]);
  const campanhas: CampanhaGoogle[] = [...porCampanha.entries()].map(([id, ls]) => {
    // status e nome mais recentes
    const ultima = ls.reduce((a, b) => (b.data > a.data ? b : a));
    return {
      ...somarGoogle(ls), id, nome: ultima.campaign_nome ?? id, status: ultima.campaign_status,
      canal: ultima.canal, conta: nomeConta.get(ultima.conta_id) ?? ultima.conta_id, contaId: ultima.conta_id,
      orcamento: ultima.orcamento_diario != null ? Number(ultima.orcamento_diario) : null,
      compartilhado: Boolean(ultima.orcamento_compartilhado),
    };
  }).sort((a, b) => b.gasto - a.gasto);

  const porAcao = new Map<string, number>();
  for (const l of doPeriodo) {
    for (const [nome, qtd] of Object.entries(l.conversoes_acao ?? {})) porAcao.set(nome, (porAcao.get(nome) ?? 0) + Number(qtd));
  }

  const dias = new Map<string, LinhaGoogle[]>();
  for (const l of doPeriodo) dias.set(l.data, [...(dias.get(l.data) ?? []), l]);
  const serie = [...dias.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([data, ls]) => {
    const s = somarGoogle(ls);
    return { data, gasto: s.gasto, resultados: s.conversoes, cpr: s.cpa };
  });

  return {
    contas,
    atual: somarGoogle(doPeriodo),
    anterior: somarGoogle(todas.filter((l) => l.data >= anterior.desde && l.data <= anterior.ate)),
    campanhas,
    porAcao: [...porAcao.entries()].sort((a, b) => b[1] - a[1]),
    serie,
  };
}

// ---------- Saldo das contas pré-pagas (a API do Google não informa) ----------

export type Recarga = { id: number; conta_id: string; data: string; valor: number; tipo: "recarga" | "saldo" };

export type SaldoGoogle = {
  saldo: number;            // estimado: saldo informado + recargas − gasto desde a data de partida
  desde: string;            // data de partida do cálculo
  mediaDia: number;         // gasto médio dos últimos 7 dias
  dias: number | null;      // dias restantes no ritmo atual
  recargas: Recarga[];
};

/**
 * Saldo estimado de cada conta do Google com recargas registradas.
 * Partida: o último "saldo informado" (saldo no início daquele dia); sem ele, a primeira recarga.
 */
export async function saldosGoogle(contaIds?: string[]) {
  const banco = db();
  let q = banco.from("recargas_google").select("id, conta_id, data, valor, tipo").order("data");
  if (contaIds) q = q.in("conta_id", contaIds);
  const { data, error } = await q;
  if (error || !data?.length) return new Map<string, SaldoGoogle>(); // sem SQL 0012 ou sem recargas
  const recargas = data as Recarga[];
  const contas = [...new Set(recargas.map((r) => r.conta_id))];
  const inicio = recargas.reduce((m, r) => (r.data < m ? r.data : m), hojeISO());
  const gastos = await buscarTudo<{ conta_id: string; data: string; gasto: number }>((de, ate) =>
    banco.from("metricas_google").select("conta_id, data, gasto").in("conta_id", contas).gte("data", [inicio, somarDias(hojeISO(), -7)].sort()[0]).range(de, ate),
  );
  const ini7 = somarDias(hojeISO(), -7), ontem = somarDias(hojeISO(), -1);
  const mapa = new Map<string, SaldoGoogle>();
  for (const conta of contas) {
    const minhas = recargas.filter((r) => r.conta_id === conta);
    const ultimoSaldo = [...minhas].reverse().find((r) => r.tipo === "saldo");
    const desde = ultimoSaldo?.data ?? minhas[0].data;
    const entradas = minhas.filter((r) => r.tipo === "recarga" && r.data >= desde && (!ultimoSaldo || r.id !== ultimoSaldo.id))
      .reduce((t, r) => t + Number(r.valor), 0);
    const meusGastos = gastos.filter((g) => g.conta_id === conta);
    const gasto = meusGastos.filter((g) => g.data >= desde).reduce((t, g) => t + Number(g.gasto), 0);
    const mediaDia = meusGastos.filter((g) => g.data >= ini7 && g.data <= ontem).reduce((t, g) => t + Number(g.gasto), 0) / 7;
    const saldo = Number(ultimoSaldo?.valor ?? 0) + entradas - gasto;
    mapa.set(conta, { saldo, desde, mediaDia, dias: mediaDia > 0 ? saldo / mediaDia : null, recargas: minhas });
  }
  return mapa;
}
