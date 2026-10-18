import "server-only";
import { db, type Cliente, type ContaAnuncio, type Metricas } from "./db";
import { progressoDoMes, hojeISO, type Periodo } from "./datas";

const ZERO: Metricas = {
  gasto: 0, impressoes: 0, alcance: 0, cliques: 0, cliques_link: 0,
  leads: 0, conversas: 0, compras: 0, valor_compras: 0,
};

/** O Supabase devolve no máximo 1000 linhas por chamada; isto pagina até o fim. */
async function buscarTudo<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  consulta: (de: number, ate: number) => PromiseLike<{ data: any[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const todos: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await consulta(de, de + 999);
    if (error) throw new Error(error.message);
    todos.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return todos;
  }
}

function somar(alvo: Metricas, linha: Partial<Metricas>) {
  for (const k of Object.keys(ZERO) as (keyof Metricas)[]) alvo[k] += Number(linha[k] ?? 0);
  return alvo;
}

export type Derivadas = Metricas & {
  resultados: number;
  cpr: number | null;   // custo por resultado (lead ou conversa)
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  frequencia: number | null;
  roas: number | null;
};

export function derivar(m: Metricas): Derivadas {
  const resultados = m.leads + m.conversas;
  const div = (a: number, b: number) => (b > 0 ? a / b : null);
  return {
    ...m,
    resultados,
    cpr: div(m.gasto, resultados),
    ctr: div(m.cliques_link * 100, m.impressoes),
    cpc: div(m.gasto, m.cliques_link),
    cpm: div(m.gasto * 1000, m.impressoes),
    // soma de alcance por anúncio/dia superestima o alcance único; é uma aproximação
    frequencia: div(m.impressoes, m.alcance),
    roas: m.valor_compras > 0 ? div(m.valor_compras, m.gasto) : null,
  };
}

type LinhaDia = Metricas & { cliente_id: string; data: string };

export type Saude = "ok" | "atencao" | "critico" | "sem_dados";

export type ResumoCliente = {
  cliente: Cliente;
  atual: Derivadas;
  anterior: Derivadas;
  mes: { gasto: number; projecao: number; ritmo: number | null };
  serie: { data: string; gasto: number; resultados: number }[];
  contas: number;
  saude: Saude;
};

function avaliarSaude(c: Cliente, atual: Derivadas, ritmo: number | null): Saude {
  if (atual.gasto === 0) return "sem_dados";
  let pontos = 0;
  if (c.cpl_meta && atual.cpr !== null) {
    if (atual.cpr > c.cpl_meta * 1.3) pontos += 2;
    else if (atual.cpr > c.cpl_meta) pontos += 1;
  }
  if (atual.gasto > 0 && atual.resultados === 0) pontos += 2;
  if (ritmo !== null && (ritmo > 1.15 || ritmo < 0.8)) pontos += 1;
  return pontos >= 2 ? "critico" : pontos === 1 ? "atencao" : "ok";
}

/** Dados da visão geral: um resumo por cliente ativo. */
export async function resumoClientes(atual: Periodo, anterior: Periodo): Promise<ResumoCliente[]> {
  const banco = db();
  const hoje = hojeISO();
  const inicioMes = `${hoje.slice(0, 8)}01`;
  const desde = [anterior.desde, inicioMes].sort()[0];

  const [{ data: clientes }, { data: contas }, dias] = await Promise.all([
    banco.from("clientes").select("*").eq("ativo", true).order("nome"),
    banco.from("contas_anuncio").select("id, cliente_id"),
    buscarTudo<LinhaDia>((de, ate) =>
      banco.from("vw_cliente_dia").select("*").gte("data", desde).lte("data", hoje).range(de, ate),
    ),
  ]);

  const { diaAtual, totalDias } = progressoDoMes();

  return ((clientes ?? []) as Cliente[]).map((c) => {
    const meus = dias.filter((d) => d.cliente_id === c.id);
    const noPeriodo = (p: Periodo) =>
      meus.filter((d) => d.data >= p.desde && d.data <= p.ate).reduce(somar, { ...ZERO });
    const a = derivar(noPeriodo(atual));
    const b = derivar(noPeriodo(anterior));
    const gastoMes = meus.filter((d) => d.data >= inicioMes).reduce((s, d) => s + Number(d.gasto), 0);
    const projecao = (gastoMes / diaAtual) * totalDias;
    const ritmo = c.orcamento_mensal ? projecao / c.orcamento_mensal : null;
    const serie = meus
      .filter((d) => d.data >= atual.desde && d.data <= atual.ate)
      .sort((x, y) => x.data.localeCompare(y.data))
      .map((d) => ({ data: d.data, gasto: Number(d.gasto), resultados: Number(d.leads) + Number(d.conversas) }));
    return {
      cliente: c,
      atual: a,
      anterior: b,
      mes: { gasto: gastoMes, projecao, ritmo },
      serie,
      contas: (contas ?? []).filter((x) => x.cliente_id === c.id).length,
      saude: avaliarSaude(c, a, ritmo),
    };
  });
}

type LinhaAnuncio = Metricas & {
  conta_id: string; data: string;
  ad_id: string; ad_nome: string;
  adset_id: string; adset_nome: string;
  campaign_id: string; campaign_nome: string;
};

export type LinhaTabela = Derivadas & { id: string; nome: string; pai?: string };

function agrupar(linhas: LinhaAnuncio[], chave: (l: LinhaAnuncio) => [string, string, string?]): LinhaTabela[] {
  const mapa = new Map<string, { nome: string; pai?: string; m: Metricas }>();
  for (const l of linhas) {
    const [id, nome, pai] = chave(l);
    const g = mapa.get(id) ?? { nome, pai, m: { ...ZERO } };
    somar(g.m, l);
    mapa.set(id, g);
  }
  return [...mapa.entries()]
    .map(([id, g]) => ({ id, nome: g.nome, pai: g.pai, ...derivar(g.m) }))
    .sort((a, b) => b.gasto - a.gasto);
}

/** Tudo que a tela do cliente precisa: totais, série diária e tabelas por nível. */
export async function detalheCliente(clienteId: string, atual: Periodo, anterior: Periodo) {
  const banco = db();
  const { data: cliente } = await banco.from("clientes").select("*").eq("id", clienteId).maybeSingle();
  if (!cliente) return null;
  const { data: contas } = await banco.from("contas_anuncio").select("*").eq("cliente_id", clienteId);
  const ids = ((contas ?? []) as ContaAnuncio[]).map((c) => c.id);

  const linhas = ids.length
    ? await buscarTudo<LinhaAnuncio>((de, ate) =>
        banco.from("metricas_diarias").select("*")
          .in("conta_id", ids).gte("data", anterior.desde).lte("data", atual.ate)
          .order("data").range(de, ate),
      )
    : [];

  const doAtual = linhas.filter((l) => l.data >= atual.desde);
  const doAnterior = linhas.filter((l) => l.data <= anterior.ate);

  const porDia = new Map<string, Metricas>();
  for (const l of doAtual) porDia.set(l.data, somar(porDia.get(l.data) ?? { ...ZERO }, l));
  const serie = [...porDia.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([data, m]) => {
      const d = derivar(m);
      return { data, gasto: d.gasto, resultados: d.resultados, cpr: d.cpr };
    });

  return {
    cliente: cliente as Cliente,
    contas: (contas ?? []) as ContaAnuncio[],
    atual: derivar(doAtual.reduce(somar, { ...ZERO })),
    anterior: derivar(doAnterior.reduce(somar, { ...ZERO })),
    serie,
    campanhas: agrupar(doAtual, (l) => [l.campaign_id, l.campaign_nome]),
    conjuntos: agrupar(doAtual, (l) => [l.adset_id, l.adset_nome, l.campaign_nome]),
    anuncios: agrupar(doAtual, (l) => [l.ad_id, l.ad_nome, l.adset_nome]),
  };
}
