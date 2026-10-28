import "server-only";
import { db, type Cliente, type ContaAnuncio, type Metricas } from "./db";
import { progressoDoMes, hojeISO, somarDias as somarDiasISO, type Periodo } from "./datas";
import { dinheiro as dinheiroBR } from "./formato";
import { completarUtms, type MapaUtm } from "./utm";
import { normalizarFunil, type FunilCliente, type NumerosFunil } from "./funil";
import { saldosGoogle, somarGoogle, type LinhaGoogle, type NumerosGoogle } from "./consultas-google";

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
  res_conv_personalizada: "conversões no site",
  res_compras: "compras",
  res_cadastro: "cadastros",
  res_outros: "outros (cliques/engajamento)",
};

/** O Supabase devolve no máximo 1000 linhas por chamada; isto pagina até o fim. */
export async function buscarTudo<T>(
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

/** Meta + Google somados: o que aparece como número principal. */
export type Geral = { gasto: number; resultados: number; cpr: number | null };

export function somarGeral(meta: { gasto: number; resultados: number }, google?: NumerosGoogle | null): Geral {
  const gasto = meta.gasto + (google?.gasto ?? 0);
  const resultados = meta.resultados + (google?.conversoes ?? 0);
  return { gasto, resultados, cpr: resultados > 0 ? gasto / resultados : null };
}

export type ResumoCliente = {
  cliente: Cliente;
  /** Meta Ads */
  atual: Derivadas;
  anterior: Derivadas;
  /** Google Ads (null se o cliente não tem conta do Google vinculada) */
  google: { atual: NumerosGoogle; anterior: NumerosGoogle } | null;
  geral: { atual: Geral; anterior: Geral };
  mes: { gasto: number; projecao: number; ritmo: number | null };
  serie: { data: string; gasto: number; resultados: number }[];
  contas: number;
  saude: Saude;
};

function avaliarSaude(c: Cliente, atual: Geral, ritmo: number | null): Saude {
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

  const [{ data: clientes }, { data: contas }, dias, { data: contasG }] = await Promise.all([
    banco.from("clientes").select("*").eq("ativo", true).order("nome"),
    banco.from("contas_anuncio").select("id, cliente_id"),
    buscarTudo<LinhaDia>((de, ate) =>
      banco.from("vw_cliente_dia").select("*").gte("data", desde).lte("data", hoje).range(de, ate),
    ),
    // se o SQL do Google ainda não rodou, vem erro e seguimos só com o Meta
    banco.from("contas_google").select("id, cliente_id").not("cliente_id", "is", null),
  ]);
  const clienteDaContaG = new Map(((contasG ?? []) as { id: string; cliente_id: string }[]).map((c) => [c.id, c.cliente_id]));
  const diasG = clienteDaContaG.size
    ? await buscarTudo<LinhaGoogle>((de, ate) =>
        banco.from("metricas_google").select("conta_id, data, gasto, impressoes, cliques, conversoes, valor_conversoes")
          .in("conta_id", [...clienteDaContaG.keys()]).gte("data", desde).lte("data", hoje).range(de, ate),
      ).catch(() => [])
    : [];

  const { diaAtual, totalDias } = progressoDoMes();

  return ((clientes ?? []) as Cliente[]).map((c) => {
    const meus = dias.filter((d) => d.cliente_id === c.id);
    const noPeriodo = (p: Periodo) =>
      meus.filter((d) => d.data >= p.desde && d.data <= p.ate).reduce(somar, { ...ZERO });
    const a = derivar(noPeriodo(atual));
    const b = derivar(noPeriodo(anterior));
    const temGoogle = [...clienteDaContaG.values()].includes(c.id);
    const meusG = temGoogle ? diasG.filter((d) => clienteDaContaG.get(d.conta_id) === c.id) : [];
    const googleDe = (p: Periodo) => somarGoogle(meusG.filter((d) => d.data >= p.desde && d.data <= p.ate));
    const google = temGoogle ? { atual: googleDe(atual), anterior: googleDe(anterior) } : null;
    const geral = { atual: somarGeral(a, google?.atual), anterior: somarGeral(b, google?.anterior) };
    const gastoMes = meus.filter((d) => d.data >= inicioMes).reduce((s, d) => s + Number(d.gasto), 0)
      + meusG.filter((d) => d.data >= inicioMes).reduce((s, d) => s + Number(d.gasto), 0);
    const projecao = (gastoMes / diaAtual) * totalDias;
    const ritmo = c.orcamento_mensal ? projecao / c.orcamento_mensal : null;
    // série diária do período com Meta + Google
    const porDia = new Map<string, { gasto: number; resultados: number }>();
    const somarDia = (data: string, gasto: number, resultados: number) => {
      const x = porDia.get(data) ?? { gasto: 0, resultados: 0 };
      porDia.set(data, { gasto: x.gasto + gasto, resultados: x.resultados + resultados });
    };
    for (const d of meus) if (d.data >= atual.desde && d.data <= atual.ate) somarDia(d.data, Number(d.gasto), Number(d.leads) + Number(d.conversas));
    for (const d of meusG) if (d.data >= atual.desde && d.data <= atual.ate) somarDia(d.data, Number(d.gasto), Number(d.conversoes));
    const serie = [...porDia.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([data, v]) => ({ data, ...v }));
    return {
      cliente: c,
      atual: a,
      anterior: b,
      google,
      geral,
      mes: { gasto: gastoMes, projecao, ritmo },
      serie,
      contas: (contas ?? []).filter((x) => x.cliente_id === c.id).length,
      saude: avaliarSaude(c, geral.atual, ritmo),
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

export type LinhaTabela = Derivadas & {
  id: string; nome: string; pai?: string; tipo: string | null; status: string | null;
  conta: string;                                   // conta do Meta (para as ações rápidas)
  campanhaId: string;                              // para navegar campanha → conjuntos → anúncios
  conjuntoId: string | null;
  orcamento: { valor: number; tipo: "dia" | "total" } | null;
};

type InfoStatus = { status: string; orcamento_diario?: number | null; orcamento_total?: number | null };

/** Rótulo do tipo de resultado que mais aparece (ex.: "conversas"), para mostrar ao lado do nome. */
export function tipoPrincipal(m: Metricas): string | null {
  const chaves = [...TIPOS_CONVERSAO, "res_outros"] as const;
  const maior = chaves.reduce((a, b) => (m[b] > m[a] ? b : a));
  return m[maior] > 0 ? ROTULO_TIPO[maior] : null;
}

function agrupar(
  linhas: LinhaAnuncio[],
  chave: (l: LinhaAnuncio) => [string, string, string?],
  status: Map<string, InfoStatus>,
): LinhaTabela[] {
  const mapa = new Map<string, { nome: string; pai?: string; conta: string; campanhaId: string; conjuntoId: string | null; m: Metricas }>();
  for (const l of linhas) {
    const [id, nome, pai] = chave(l);
    const g = mapa.get(id) ?? { nome, pai, conta: l.conta_id, campanhaId: l.campaign_id, conjuntoId: l.adset_id ?? null, m: { ...ZERO } };
    somar(g.m, l);
    mapa.set(id, g);
  }
  return [...mapa.entries()]
    .map(([id, g]) => {
      const st = status.get(id);
      const orcamento = st?.orcamento_diario ? { valor: Number(st.orcamento_diario), tipo: "dia" as const }
        : st?.orcamento_total ? { valor: Number(st.orcamento_total), tipo: "total" as const } : null;
      return { id, nome: g.nome, pai: g.pai, conta: g.conta, campanhaId: g.campanhaId, conjuntoId: g.conjuntoId, orcamento, tipo: tipoPrincipal(g.m), status: st?.status ?? null, ...derivar(g.m) };
    })
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
  // Status é informativo: se a tabela ainda não existir ou falhar, a tela abre sem os selos.
  const lerStatus = (colunas: string) => buscarTudo<InfoStatus & { id: string }>((de, ate) =>
    banco.from("status_meta").select(colunas).in("conta_id", ids).range(de, ate),
  );
  const statusRows = ids.length
    // sem o SQL 0012 não há colunas de orçamento: lê só o status
    ? await lerStatus("id, status, orcamento_diario, orcamento_total").catch(() => lerStatus("id, status")).catch((e) => {
        console.error("status_meta:", e);
        return [];
      })
    : [];
  const status = new Map(statusRows.map((r) => [r.id, r]));

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
    campanhas: agrupar(doAtual, (l) => [l.campaign_id, l.campaign_nome], status),
    conjuntos: agrupar(doAtual, (l) => [l.adset_id, l.adset_nome, l.campaign_nome], status),
    anuncios: agrupar(doAtual, (l) => [l.ad_id, l.ad_nome, l.adset_nome], status),
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

/**
 * Google: saldo estimado pelas recargas registradas (contas pré-pagas) ou orçamento da conta (limite de gastos).
 * Mesma regra do Meta: avisa quando dá para DIAS_SALDO_ALERTA dias ou menos.
 */
async function alertasSaldoGoogle(nomeCliente: Map<string, string>): Promise<AlertaConta[]> {
  const { data: contasRaw, error } = await db().from("contas_google")
    .select("id, nome, cliente_id, limite_conta, gasto_limite").not("cliente_id", "is", null);
  if (error) return [];
  const contas = (contasRaw ?? []) as { id: string; nome: string; cliente_id: string; limite_conta: number | null; gasto_limite: number | null }[];
  const saldos = await saldosGoogle(contas.map((c) => c.id));
  // média dos últimos 7 dias, para as contas com limite (as com recarga já vêm calculadas)
  const ini7 = somarDiasISO(hojeISO(), -7);
  const comLimite = contas.filter((c) => c.limite_conta != null && !saldos.has(c.id));
  const gastos = comLimite.length
    ? await buscarTudo<{ conta_id: string; gasto: number }>((de, ate) =>
        db().from("metricas_google").select("conta_id, gasto").in("conta_id", comLimite.map((c) => c.id))
          .gte("data", ini7).lt("data", hojeISO()).range(de, ate),
      )
    : [];
  const alertas: AlertaConta[] = [];
  for (const c of contas) {
    const clienteNome = nomeCliente.get(c.cliente_id);
    if (!clienteNome) continue;
    const s = saldos.get(c.id);
    const [restante, mediaDia, oque] = s
      ? [s.saldo, s.mediaDia, "Saldo estimado do Google (pelas recargas registradas)"]
      : c.limite_conta != null
        ? [c.limite_conta - Number(c.gasto_limite ?? 0), gastos.filter((g) => g.conta_id === c.id).reduce((t, g) => t + Number(g.gasto), 0) / 7, "Orçamento da conta do Google"]
        : [null, 0, ""];
    if (restante == null) continue;
    const base = { clienteId: c.cliente_id, clienteNome, contaNome: `Google · ${c.nome}` };
    if (restante <= 0) {
      alertas.push({ ...base, nivel: "critico", mensagem: `${oque} esgotado. Confira a conta e registre a recarga no painel.` });
      continue;
    }
    if (mediaDia <= 0) continue;
    const dias = restante / mediaDia;
    if (dias <= DIAS_SALDO_ALERTA) {
      alertas.push({
        ...base,
        nivel: dias <= 1 ? "critico" : "atencao",
        mensagem: `${oque}: ${dinheiroBR(restante)}, dá para ~${dias < 1 ? "menos de 1 dia" : `${Math.floor(dias)} dia(s)`} no ritmo atual (${dinheiroBR(mediaDia)}/dia). Recarregue.`,
      });
    }
  }
  return alertas;
}

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
  alertas.push(...(await alertasSaldoGoogle(nomeCliente).catch(() => [])));
  return alertas.sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === "critico" ? -1 : 1));
}

// ---------- CRM ----------

export type NegocioCrm = {
  id: string; cliente_id: string; nome: string | null;
  pipeline_id: string | null; pipeline_nome: string | null; etapa_id?: string | null; etapa_nome: string | null;
  criado_em: string; fechado_em: string | null; etapa_ordem: number | null;
  ganho: boolean | null; valor: number; campanha: string | null; origem: string | null;
  responsavel: string | null; campos: Record<string, string> | null;
  utm_source?: string | null; utm_medium?: string | null; utm_campaign?: string | null;
  utm_content?: string | null; utm_term?: string | null;
};

/** Dimensões de UTM para o relatório de origem dos leads e vendas. */
export const DIMENSOES_UTM = [
  { chave: "utm_source", rotulo: "Origem", dica: "utm_source (ex.: facebook, google, instagram)" },
  { chave: "utm_medium", rotulo: "Mídia", dica: "utm_medium (ex.: cpc, paid_social)" },
  { chave: "utm_campaign", rotulo: "Campanha", dica: "utm_campaign" },
  { chave: "utm_content", rotulo: "Conteúdo / anúncio", dica: "utm_content (geralmente o nome do anúncio)" },
  { chave: "utm_term", rotulo: "Termo / público", dica: "utm_term (palavra-chave ou público)" },
] as const;
export type DimensaoUtm = (typeof DIMENSOES_UTM)[number]["chave"];

const COLUNAS_NEGOCIO = "id, cliente_id, nome, pipeline_id, pipeline_nome, etapa_id, etapa_nome, criado_em, fechado_em, etapa_ordem, ganho, valor, campanha, origem, responsavel, campos";
const COLUNAS_UTM = "utm_source, utm_medium, utm_campaign, utm_content, utm_term";
export type ConexaoResumo = {
  cliente_id: string; pipeline_id: string | null; etapa_qualificado_ordem: number | null;
  fontes_anuncio: string[] | null; ultima_sync: string | null; ultimo_erro: string | null;
  mapa_utm?: MapaUtm | null;
  // segunda etapa do funil (SQL 0015): propostas, projetos, agendamentos…
  pipeline_proposta_id?: string | null;
  etapa_proposta_ordem?: number | null;
  // funil do relatório montado pelo usuário (SQL 0018) e nomes antigos das etapas (SQL 0015)
  funil?: Partial<FunilCliente> | null;
  rotulos?: { leads?: string; interessados?: string; propostas?: string; vendas?: string } | null;
};

/**
 * Funil do relatório do cliente. Sem funil montado, usa a configuração antiga
 * (etapa de qualificação e de propostas, contando pela ordem das etapas).
 */
export function funilDaConexao(cx: ConexaoResumo): FunilCliente & { teste: ((n: NegocioCrm) => boolean)[] } {
  if (cx.funil) {
    const f = normalizarFunil(cx.funil);
    // conta no passo quem está numa etapa dele ou de qualquer passo seguinte (já passou por ele), ou foi ganho
    const teste = f.passos.map((_, i) => {
      const etapas = new Set(f.passos.slice(i).flatMap((p) => p.etapas));
      return (n: NegocioCrm) => n.ganho === true || (!!n.etapa_id && etapas.has(n.etapa_id));
    });
    return { ...f, teste };
  }
  const r = cx.rotulos ?? {};
  const passos: { nome: string; teste: (n: NegocioCrm) => boolean }[] = [];
  if (cx.etapa_qualificado_ordem != null) {
    passos.push({
      nome: r.interessados || "Interessados",
      teste: (n) => n.ganho === true || ((!cx.pipeline_id || n.pipeline_id === cx.pipeline_id) && (n.etapa_ordem ?? -1) >= cx.etapa_qualificado_ordem!),
    });
  }
  if (cx.etapa_proposta_ordem != null) {
    passos.push({
      nome: r.propostas || "Propostas",
      teste: (n) => n.ganho === true || ((!cx.pipeline_proposta_id || n.pipeline_id === cx.pipeline_proposta_id) && (n.etapa_ordem ?? -1) >= cx.etapa_proposta_ordem!),
    });
  }
  return {
    soAnuncio: true, leads: r.leads || "Leads", vendas: r.vendas || "Vendas", funis: [],
    passos: passos.map((p) => ({ nome: p.nome, etapas: [] })), teste: passos.map((p) => p.teste),
  };
}

/** Fontes que parecem de anúncio, usadas enquanto o usuário não escolhe as fontes manualmente. */
const FONTE_ANUNCIO_AUTO = /facebook|meta|instagram|google|tiktok|linkedin|\bads?\b|an[uú]ncio|tr[aá]fego|pago|paid|cpc/i;

/** Opção da lista de fontes para os negócios sem fonte preenchida no CRM. */
export const SEM_FONTE = "(sem fonte)";

export function ehFonteAnuncio(fonte: string | null, escolhidas: string[] | null) {
  // sem fonte: só conta se o usuário marcou "(sem fonte)" na lista
  if (!fonte?.trim()) return !!escolhidas?.includes(SEM_FONTE);
  return escolhidas ? escolhidas.includes(fonte) : FONTE_ANUNCIO_AUTO.test(fonte);
}

export type NumerosCrm = {
  leads: number;
  leadsAnuncio: number;
  qualificados: number | null;        // null = etapa de qualificação não configurada
  qualificadosAnuncio: number | null;
  propostas: number | null;           // null = etapa de propostas não configurada
  vendas: number;
  vendasAnuncio: number;
  faturamento: number;
  faturamentoAnuncio: number;
  emNegociacao: number;               // valor dos negócios em aberto criados no período
  funil: NumerosFunil;                // funil do relatório (só anúncio, se o cliente estiver configurado assim)
};

// um formatador só (criar um por negócio deixava o histórico de clientes grandes lento demais)
const formatoDiaSP = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });
const diasSP = new Map<string, string>();
const diaSP = (iso: string) => {
  let d = diasSP.get(iso);
  if (!d) {
    d = formatoDiaSP.format(new Date(iso));
    if (diasSP.size > 200_000) diasSP.clear();
    diasSP.set(iso, d);
  }
  return d;
};
export const noPeriodo = (iso: string | null, p: { desde: string; ate: string }) => { if (!iso) return false; const d = diaSP(iso); return d >= p.desde && d <= p.ate; };

/**
 * Leads e qualificados: negócios CRIADOS no período, em qualquer funil.
 * Qualificado: chegou no funil de qualificação (na etapa escolhida ou depois) ou foi ganho.
 * Vendas e faturamento: negócios GANHOS com data de fechamento no período.
 */
/** O negócio entra no funil do relatório? (fonte de anúncio, se configurado, e um dos funis escolhidos) */
export function entraNoFunil(n: NegocioCrm, f: FunilCliente, cx: ConexaoResumo) {
  if (f.soAnuncio && !ehFonteAnuncio(n.origem, cx.fontes_anuncio)) return false;
  return !f.funis.length || (!!n.pipeline_id && f.funis.includes(n.pipeline_id));
}

export function numerosCrm(negocios: NegocioCrm[], cx: ConexaoResumo, p: { desde: string; ate: string }): NumerosCrm {
  const anuncio = (n: NegocioCrm) => ehFonteAnuncio(n.origem, cx.fontes_anuncio);
  const qualificado = (n: NegocioCrm) =>
    n.ganho === true ||
    (cx.etapa_qualificado_ordem != null && (!cx.pipeline_id || n.pipeline_id === cx.pipeline_id) &&
      (n.etapa_ordem ?? -1) >= cx.etapa_qualificado_ordem);
  const proposta = (n: NegocioCrm) =>
    n.ganho === true ||
    ((!cx.pipeline_proposta_id || n.pipeline_id === cx.pipeline_proposta_id) &&
      (n.etapa_ordem ?? -1) >= (cx.etapa_proposta_ordem ?? Infinity));
  const criados = negocios.filter((n) => noPeriodo(n.criado_em, p));
  const ganhos = negocios.filter((n) => n.ganho === true && noPeriodo(n.fechado_em, p));
  const semEtapa = cx.etapa_qualificado_ordem == null;
  const f = funilDaConexao(cx);
  const doFunil = (ns: NegocioCrm[]) => ns.filter((n) => entraNoFunil(n, f, cx));
  const criadosF = doFunil(criados), ganhosF = doFunil(ganhos);
  return {
    funil: {
      leads: criadosF.length,
      passos: f.passos.map((p, i) => {
        const doPasso = criadosF.filter(f.teste[i]);
        return { nome: p.nome, valor: doPasso.length, ...(p.somarValor && { soma: doPasso.reduce((s, n) => s + Number(n.valor), 0) }) };
      }),
      vendas: ganhosF.length,
      faturamento: ganhosF.reduce((s, n) => s + Number(n.valor), 0),
    },
    leads: criados.length,
    leadsAnuncio: criados.filter(anuncio).length,
    qualificados: semEtapa ? null : criados.filter(qualificado).length,
    qualificadosAnuncio: semEtapa ? null : criados.filter((n) => anuncio(n) && qualificado(n)).length,
    propostas: cx.etapa_proposta_ordem == null ? null : criados.filter(proposta).length,
    vendas: ganhos.length,
    vendasAnuncio: ganhos.filter(anuncio).length,
    faturamento: ganhos.reduce((s, n) => s + Number(n.valor), 0),
    faturamentoAnuncio: ganhos.filter(anuncio).reduce((s, n) => s + Number(n.valor), 0),
    emNegociacao: criados.filter((n) => n.ganho == null).reduce((s, n) => s + Number(n.valor), 0),
  };
}

export async function negociosDe(clienteIds: string[], desde: string) {
  if (!clienteIds.length) return [];
  // margem de 1 dia por causa do fuso
  const limite = `${somarDiasISO(desde, -1)}T00:00:00Z`;
  const buscar = (colunas: string) => buscarTudo<NegocioCrm>((de, ate) =>
    db().from("crm_negocios")
      .select(colunas)
      .in("cliente_id", clienteIds)
      .or(`criado_em.gte.${limite},fechado_em.gte.${limite}`)
      .range(de, ate),
  );
  // sem o SQL 0011 as colunas de UTM não existem: segue sem elas
  return buscar(`${COLUNAS_NEGOCIO}, ${COLUNAS_UTM}`).catch(() => buscar(COLUNAS_NEGOCIO));
}

const COLUNAS_CONEXAO = "cliente_id, pipeline_id, etapa_qualificado_ordem, fontes_anuncio, ultima_sync, ultimo_erro";

/** Números do CRM por cliente para a visão geral (só clientes com CRM conectado). */
export async function resumoCrm(atual: Periodo, anterior: Periodo) {
  const { data: conexoes } = await db().from("crm_conexoes").select(COLUNAS_CONEXAO);  // a visão geral não usa UTMs
  const lista = (conexoes ?? []) as ConexaoResumo[];
  const negocios = await negociosDe(lista.map((c) => c.cliente_id), anterior.desde);
  return new Map(lista.map((cx) => {
    const meus = negocios.filter((n) => n.cliente_id === cx.cliente_id);
    return [cx.cliente_id, { atual: numerosCrm(meus, cx, atual), anterior: numerosCrm(meus, cx, anterior) }] as const;
  }));
}

/** Campos personalizados que parecem valor/orçamento, para destacar na lista de negócios. */
const CAMPO_VALOR = /or[cç]amento|valor|ticket|budget|investimento|pre[cç]o/i;

/** CRM na tela do cliente: totais, quebra por fonte e lista de negócios do período. */
export async function detalheCrm(clienteId: string, atual: Periodo, anterior: Periodo) {
  // mapa_utm vem do SQL 0014; sem ele, segue só com a detecção automática
  const ler = (colunas: string) => db().from("crm_conexoes").select(colunas).eq("cliente_id", clienteId).maybeSingle();
  // funil/rótulos (SQL 0015 e 0018) e mapa_utm (SQL 0014): cada um que faltar, tenta sem
  let resp = await ler(`${COLUNAS_CONEXAO}, mapa_utm, funil, rotulos, pipeline_proposta_id, etapa_proposta_ordem`);
  if (resp.error) resp = await ler(`${COLUNAS_CONEXAO}, mapa_utm`);
  if (resp.error) resp = await ler(COLUNAS_CONEXAO);
  const { data } = resp;
  if (!data) return null;
  const cx = data as unknown as ConexaoResumo;
  // UTMs: atribuição do CRM + campos personalizados ("Campanha", "Criativo", "Público"…), conforme o mapa do cliente
  const negocios = (await negociosDe([clienteId], anterior.desde)).map((n) => {
    const u = completarUtms(n, n.campos, cx.mapa_utm);
    return { ...n, utm_source: u.source, utm_medium: u.medium, utm_campaign: u.campaign, utm_content: u.content, utm_term: u.term };
  });

  const grupos = new Map<string, NegocioCrm[]>();
  for (const n of negocios) {
    const chave = n.origem || "Sem fonte";
    grupos.set(chave, [...(grupos.get(chave) ?? []), n]);
  }
  const porFonte = [...grupos.entries()]
    .map(([nome, ns]) => ({ nome, anuncio: ehFonteAnuncio(nome === "Sem fonte" ? null : nome, cx.fontes_anuncio), ...numerosCrm(ns, cx, atual) }))
    .filter((g) => g.leads || g.vendas)
    .sort((a, b) => Number(b.anuncio) - Number(a.anuncio) || b.leads - a.leads);

  const lista = negocios
    .filter((n) => noPeriodo(n.criado_em, atual) || (n.ganho === true && noPeriodo(n.fechado_em, atual)))
    .sort((a, b) => b.criado_em.localeCompare(a.criado_em))
    .slice(0, 100)
    .map((n) => ({
      ...n,
      anuncio: ehFonteAnuncio(n.origem, cx.fontes_anuncio),
      destaques: Object.entries(n.campos ?? {}).filter(([k]) => CAMPO_VALOR.test(k)),
    }));

  // origem por UTM: uma tabela para cada dimensão (Origem, Mídia, Campanha, Conteúdo, Termo)
  const porUtm = Object.fromEntries(DIMENSOES_UTM.map(({ chave }) => {
    const g = new Map<string, NegocioCrm[]>();
    for (const n of negocios) {
      const v = n[chave]?.trim() || "(sem UTM)";
      g.set(v, [...(g.get(v) ?? []), n]);
    }
    const linhas = [...g.entries()]
      .map(([nome, ns]) => ({ nome, ...numerosCrm(ns, cx, atual) }))
      .filter((x) => x.leads || x.vendas)
      .sort((a, b) => Number(a.nome === "(sem UTM)") - Number(b.nome === "(sem UTM)") || b.faturamento - a.faturamento || b.vendas - a.vendas || b.leads - a.leads);
    return [chave, linhas];
  })) as Record<DimensaoUtm, ({ nome: string } & NumerosCrm)[]>;
  const temUtm = negocios.some((n) => DIMENSOES_UTM.some(({ chave }) => n[chave]));

  return {
    conexao: cx,
    porUtm,
    temUtm,
    fontesManuais: cx.fontes_anuncio != null,
    atual: numerosCrm(negocios, cx, atual),
    anterior: numerosCrm(negocios, cx, anterior),
    porFonte,
    negocios: lista,
  };
}

/** Fontes distintas dos negócios do cliente (para escolher quais são de anúncio). */
export async function fontesDoCliente(clienteId: string) {
  const linhas = await buscarTudo<{ origem: string | null }>((de, ate) =>
    db().from("crm_negocios").select("origem").eq("cliente_id", clienteId).range(de, ate),
  );
  const contagem = new Map<string, number>();
  for (const l of linhas) {
    const f = l.origem?.trim() || SEM_FONTE;
    contagem.set(f, (contagem.get(f) ?? 0) + 1);
  }
  return [...contagem.entries()].sort((a, b) => b[1] - a[1]).map(([nome, total]) => ({ nome, total }));
}

/** Campos personalizados que aparecem nos negócios do cliente, com um exemplo de valor (para mapear as UTMs). */
export async function camposDoClienteCrm(clienteId: string) {
  const { data } = await db().from("crm_negocios").select("campos").eq("cliente_id", clienteId)
    .not("campos", "is", null).order("criado_em", { ascending: false }).limit(1000);
  const mapa = new Map<string, { total: number; exemplo: string }>();
  for (const { campos } of (data ?? []) as { campos: Record<string, string> }[]) {
    for (const [nome, valor] of Object.entries(campos ?? {})) {
      const atual = mapa.get(nome) ?? { total: 0, exemplo: String(valor) };
      mapa.set(nome, { total: atual.total + 1, exemplo: atual.exemplo });
    }
  }
  return [...mapa.entries()].map(([nome, x]) => ({ nome, ...x })).sort((a, b) => b.total - a.total);
}
