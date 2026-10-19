import "server-only";
import { db, type Cliente, type ContaAnuncio, type Metricas } from "./db";
import { progressoDoMes, hojeISO, somarDias as somarDiasISO, type Periodo } from "./datas";
import { dinheiro as dinheiroBR } from "./formato";

const ZERO: Metricas = {
  gasto: 0, impressoes: 0, alcance: 0, cliques: 0, cliques_link: 0,
  leads: 0, conversas: 0, compras: 0, valor_compras: 0,
  res_conversas: 0, res_formulario: 0, res_lead_site: 0, res_conv_personalizada: 0,
  res_compras: 0, res_cadastro: 0, res_outros: 0,
};

/** Tipos que contam como resultado no custo por resultado (cliques e engajamento ficam de fora). */
export const TIPOS_CONVERSAO = [
  "res_conversas", "res_formulario", "res_lead_site", "res_conv_personalizada", "res_compras", "res_cadastro",
] as const;

export const ROTULO_TIPO: Record<(typeof TIPOS_CONVERSAO)[number] | "res_outros", string> = {
  res_conversas: "conversas",
  res_formulario: "formulário",
  res_lead_site: "leads no site",
  res_conv_personalizada: "conv. personalizada",
  res_compras: "compras",
  res_cadastro: "cadastros",
  res_outros: "outros (cliques/engajamento)",
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
  cpr: number | null;   // custo por resultado (soma dos tipos de conversão)
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  frequencia: number | null;
  roas: number | null;
};

export function derivar(m: Metricas): Derivadas {
  const resultados = TIPOS_CONVERSAO.reduce((t, k) => t + m[k], 0);
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
  resultados: number; resultado_tipo: string | null;
};

/** Espalha o "resultado" da linha na coluna res_* do tipo dela (linhas antigas sem tipo: conversas + leads). */
function comTipos(l: LinhaAnuncio): LinhaAnuncio {
  const m = { ...l, ...Object.fromEntries([...TIPOS_CONVERSAO, "res_outros"].map((k) => [k, 0])) } as LinhaAnuncio;
  if (l.resultado_tipo) {
    const k = `res_${l.resultado_tipo}` as keyof Metricas;
    if (k in ZERO) m[k] = Number(l.resultados);
  } else {
    m.res_conversas = Number(l.conversas);
    m.res_lead_site = Number(l.leads);
  }
  return m;
}

export type LinhaTabela = Derivadas & { id: string; nome: string; pai?: string; tipo: string | null };

/** Rótulo do tipo de resultado que mais aparece (ex.: "conversas"), para mostrar ao lado do nome. */
export function tipoPrincipal(m: Metricas): string | null {
  const chaves = [...TIPOS_CONVERSAO, "res_outros"] as const;
  const maior = chaves.reduce((a, b) => (m[b] > m[a] ? b : a));
  return m[maior] > 0 ? ROTULO_TIPO[maior] : null;
}

function agrupar(linhas: LinhaAnuncio[], chave: (l: LinhaAnuncio) => [string, string, string?]): LinhaTabela[] {
  const mapa = new Map<string, { nome: string; pai?: string; m: Metricas }>();
  for (const l of linhas) {
    const [id, nome, pai] = chave(l);
    const g = mapa.get(id) ?? { nome, pai, m: { ...ZERO } };
    somar(g.m, l);
    mapa.set(id, g);
  }
  return [...mapa.entries()]
    .map(([id, g]) => ({ id, nome: g.nome, pai: g.pai, tipo: tipoPrincipal(g.m), ...derivar(g.m) }))
    .sort((a, b) => b.gasto - a.gasto);
}

/** Tudo que a tela do cliente precisa: totais, série diária e tabelas por nível. */
export async function detalheCliente(clienteId: string, atual: Periodo, anterior: Periodo) {
  const banco = db();
  const { data: cliente } = await banco.from("clientes").select("*").eq("id", clienteId).maybeSingle();
  if (!cliente) return null;
  const { data: contas } = await banco.from("contas_anuncio").select("*").eq("cliente_id", clienteId);
  const ids = ((contas ?? []) as ContaAnuncio[]).map((c) => c.id);

  const brutas = ids.length
    ? await buscarTudo<LinhaAnuncio>((de, ate) =>
        banco.from("metricas_diarias").select("*")
          .in("conta_id", ids).gte("data", anterior.desde).lte("data", atual.ate)
          .order("data").range(de, ate),
      )
    : [];
  const linhas = brutas.map(comTipos);

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

const STATUS_CONTA: Record<number, string> = {
  2: "conta desativada",
  3: "pagamento pendente (conta bloqueada por falta de pagamento)",
  7: "conta em análise pelo Meta",
  9: "conta em período de carência de pagamento",
  100: "conta com encerramento pendente",
  101: "conta encerrada",
};

export type AlertaConta = {
  clienteId: string;
  clienteNome: string;
  contaNome: string;
  nivel: "critico" | "atencao";
  mensagem: string;
};

/** Até quantos dias de saldo/limite o painel considera "baixo". */
export const DIAS_SALDO_ALERTA = 5;

/**
 * Problemas de saldo, limite de gastos e status nas contas vinculadas a clientes.
 * Os dias restantes usam a média de gasto diário dos últimos 7 dias da conta.
 */
export async function alertasContas(): Promise<AlertaConta[]> {
  const banco = db();
  const desde = somarDiasISO(hojeISO(), -7);
  const [{ data: contas }, { data: clientes }, gastos] = await Promise.all([
    banco.from("contas_anuncio").select("*").not("cliente_id", "is", null),
    banco.from("clientes").select("id, nome").eq("ativo", true),
    buscarTudo<{ conta_id: string; gasto: number }>((de, ate) =>
      banco.from("metricas_diarias").select("conta_id, gasto").gte("data", desde).range(de, ate),
    ),
  ]);
  const nomeCliente = new Map((clientes ?? []).map((c) => [c.id as string, c.nome as string]));
  const gasto7d = new Map<string, number>();
  for (const g of gastos) gasto7d.set(g.conta_id, (gasto7d.get(g.conta_id) ?? 0) + Number(g.gasto));

  const alertas: AlertaConta[] = [];
  for (const c of (contas ?? []) as ContaAnuncio[]) {
    const clienteNome = nomeCliente.get(c.cliente_id ?? "");
    if (!clienteNome) continue; // cliente inativo
    const base = { clienteId: c.cliente_id!, clienteNome, contaNome: c.nome };

    if (c.status != null && STATUS_CONTA[c.status]) {
      alertas.push({ ...base, nivel: "critico", mensagem: STATUS_CONTA[c.status] });
    }

    const mediaDia = (gasto7d.get(c.id) ?? 0) / 7;

    // Nas contas pré-pagas o Meta implementa o saldo como limite de gastos, então os dois
    // números são o mesmo dinheiro. Usa o saldo nelas e o limite só nas pós-pagas.
    const [restante, oque] =
      c.pre_paga && c.saldo != null
        ? [c.saldo, "Saldo pré-pago"]
        : c.limite_gasto != null && c.total_gasto != null
          ? [c.limite_gasto - c.total_gasto, "Limite de gastos da conta"]
          : [null, ""];
    if (restante === null) continue;

    if (restante <= 0) {
      // Avisa mesmo com a conta parada há dias: muitas vezes é o cliente que ainda não pagou.
      const parada = mediaDia <= 0 ? " Sem veiculação nos últimos 7 dias." : " Os anúncios param de rodar.";
      alertas.push({ ...base, nivel: "critico", mensagem: `${oque} esgotado.${parada}` });
      continue;
    }
    if (mediaDia <= 0) continue; // sem gasto recente não dá para estimar os dias restantes
    const dias = restante / mediaDia;
    if (dias <= DIAS_SALDO_ALERTA) {
      alertas.push({
        ...base,
        nivel: dias <= 1 ? "critico" : "atencao",
        mensagem: `${oque}: ${dinheiroBR(restante)}, dá para ~${dias < 1 ? "menos de 1 dia" : `${Math.floor(dias)} dia(s)`} no ritmo atual (${dinheiroBR(mediaDia)}/dia). Recarregue.`,
      });
    }
  }
  return alertas.sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === "critico" ? -1 : 1));
}
