import "server-only";
import { db, type ContaAnuncio } from "./db";
import { extrairResultados, insightsMensais } from "./meta";
import { metricasMensais, tokenDeAcesso } from "./google";
import { tokenDaConta } from "./sync";
import { sincronizarCrmCliente, type ConexaoCrm } from "./crm/sync";
import { funilDaConexao, negociosDe, numerosCrm, TIPOS_CONVERSAO, type ConexaoResumo } from "./consultas";
import { FUNIL_PADRAO, type FunilCliente } from "./funil";
import { hojeISO } from "./datas";

// Histórico mensal de cada cliente (o que antes ficava na planilha): investimento, leads, funil do CRM e vendas.
// Cada mês é gravado uma vez e fica salvo; a rotina diária só recalcula o mês atual (e o anterior até o dia 10).

export type LinhaHistorico = {
  cliente_id: string;
  mes: string; // AAAA-MM-01
  gasto_meta: number;
  gasto_google: number;
  resultados_meta: number;
  resultados_google: number;
  crm: boolean;
  leads: number | null;
  interessados: number | null; // versão antiga (antes do funil por cliente)
  propostas: number | null;
  passos?: { nome: string; valor: number }[] | null; // passos do meio do funil do cliente (SQL 0018)
  vendas: number | null;
  faturamento: number | null;
  ajustes: Record<string, number> | null; // "investimento", "leads", "vendas", "faturamento" e "passo:<nome>"
  observacao: string | null;
  atualizado_em: string;
};

/** Campos fixos que dá para corrigir à mão (os passos do funil usam a chave "passo:<nome>"). */
export const CAMPOS_AJUSTAVEIS = ["investimento", "leads", "vendas", "faturamento"] as const;
export const chavePasso = (nome: string) => `passo:${nome}`;

/** Passo do funil no mês, com a taxa em relação ao passo anterior. */
export type PassoMes = { nome: string; valor: number | null; taxa: number | null };

/** Mês com os números finais (ajustes manuais aplicados) e as taxas da planilha. */
export type MesConsolidado = {
  mes: string;
  investimento: number;
  gastoMeta: number;
  gastoGoogle: number;
  leads: number | null;
  passos: PassoMes[];
  vendas: number | null;
  faturamento: number | null;
  conversaoVendas: number | null;  // vendas / último passo (ou / leads, sem passos)
  roas: number | null;
  cpl: number | null;
  cplQualificado: number | null;   // investimento / primeiro passo
  ajustado: string[];
  observacao: string | null;
  crm: boolean;
};

const div = (a: number | null, b: number | null) => (a != null && b ? a / b : null);

export function consolidar(l: LinhaHistorico): MesConsolidado {
  const aj = l.ajustes ?? {};
  const investimento = aj.investimento ?? Number(l.gasto_meta) + Number(l.gasto_google);
  // sem CRM, "leads" são os resultados das plataformas (formulários, conversas…)
  const leads = aj.leads ?? (l.crm ? l.leads : Math.round(Number(l.resultados_meta) + Number(l.resultados_google)));
  // meses gravados antes do funil por cliente: interessados e propostas viram os passos
  const brutos = l.passos ?? [
    ...(l.interessados != null ? [{ nome: "Interessados", valor: l.interessados }] : []),
    ...(l.propostas != null ? [{ nome: "Propostas", valor: l.propostas }] : []),
  ];
  let anterior = leads;
  const passos: PassoMes[] = brutos.map((p) => {
    const valor = aj[chavePasso(p.nome)] ?? p.valor;
    const passo = { nome: p.nome, valor, taxa: div(valor, anterior) };
    anterior = valor;
    return passo;
  });
  const vendas = aj.vendas ?? l.vendas;
  const faturamento = aj.faturamento ?? (l.faturamento == null ? null : Number(l.faturamento));
  return {
    mes: l.mes,
    investimento,
    gastoMeta: Number(l.gasto_meta),
    gastoGoogle: Number(l.gasto_google),
    leads, passos, vendas, faturamento,
    conversaoVendas: div(vendas, anterior),
    roas: faturamento ? div(faturamento, investimento) : null,
    cpl: div(investimento, leads),
    cplQualificado: passos.length ? div(investimento, passos[0].valor) : null,
    ajustado: Object.keys(aj),
    observacao: l.observacao,
    crm: l.crm,
  };
}

/** O mês tem algum número (investimento, leads, passos, vendas ou faturamento)? */
export const temDados = (m: MesConsolidado) =>
  m.investimento > 0 || !!m.leads || !!m.vendas || !!m.faturamento || m.passos.some((p) => !!p.valor);

/** Nomes dos passos que aparecem nos meses, na ordem do mês mais recente. */
export function nomesDosPassos(meses: MesConsolidado[]) {
  const nomes: string[] = [];
  for (const m of meses) for (const p of m.passos) if (!nomes.includes(p.nome)) nomes.push(p.nome);
  return nomes;
}

/** Soma vários meses (para o total do período) e recalcula as taxas. */
export function somarMeses(meses: MesConsolidado[]): MesConsolidado | null {
  if (!meses.length) return null;
  const soma = (f: (m: MesConsolidado) => number | null) =>
    meses.some((m) => f(m) != null) ? meses.reduce((t, m) => t + (f(m) ?? 0), 0) : null;
  const linha: LinhaHistorico = {
    cliente_id: "", mes: "total", crm: true, observacao: null, atualizado_em: "",
    gasto_meta: meses.reduce((t, m) => t + m.gastoMeta, 0), gasto_google: meses.reduce((t, m) => t + m.gastoGoogle, 0),
    resultados_meta: 0, resultados_google: 0, interessados: null, propostas: null,
    leads: soma((m) => m.leads), vendas: soma((m) => m.vendas), faturamento: soma((m) => m.faturamento),
    passos: nomesDosPassos(meses).map((nome) => ({ nome, valor: soma((m) => m.passos.find((p) => p.nome === nome)?.valor ?? null) ?? 0 })),
    // investimento pode ter ajuste manual em algum mês: soma o valor final de cada mês
    ajustes: { investimento: meses.reduce((t, m) => t + m.investimento, 0) },
  };
  return { ...consolidar(linha), ajustado: [] };
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const nomeMes = (mes: string, comAno = true) =>
  `${MESES[Number(mes.slice(5, 7)) - 1]}${comAno ? `/${mes.slice(0, 4)}` : ""}`;

/** 1º dia do mês de uma data AAAA-MM-DD, deslocado `n` meses. */
export function mesDe(iso: string, n = 0) {
  const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

function ultimoDia(mes: string) {
  const d = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0));
  return d.toISOString().slice(0, 10);
}

function mesesEntre(desde: string, ate: string) {
  const lista: string[] = [];
  for (let m = mesDe(desde); m <= ate; m = mesDe(m, 1)) lista.push(m);
  return lista;
}

export async function lerHistorico(clienteId: string): Promise<{ meses: MesConsolidado[]; erro: string | null }> {
  const { data, error } = await db().from("historico_mensal").select("*").eq("cliente_id", clienteId).order("mes", { ascending: false });
  if (error) return { meses: [], erro: error.message };
  // meses sem nenhum número (antes de o cliente começar, por exemplo) não aparecem
  return { meses: ((data ?? []) as LinhaHistorico[]).map(consolidar).filter(temDados), erro: null };
}

/** Funil do relatório do cliente (nomes e passos); sem CRM, só Leads → Vendas. */
export async function funilDoCliente(clienteId: string): Promise<FunilCliente> {
  const { data } = await db().from("crm_conexoes").select("*").eq("cliente_id", clienteId).maybeSingle();
  if (!data) return FUNIL_PADRAO;
  const { teste, ...f } = funilDaConexao(data as ConexaoResumo);
  void teste;
  return f;
}

/**
 * Recalcula e grava os meses de `desdeMes` a `ateMes` de um cliente (Meta + Google pelas APIs, funil pelo CRM).
 * Se uma fonte falhar, os números dela ficam como estavam (não zera o que já foi gravado).
 */
export async function gravarHistorico(clienteId: string, desdeMes: string, ateMes: string) {
  const banco = db();
  const hoje = hojeISO();
  const meses = mesesEntre(desdeMes, ateMes > hoje ? hoje : ateMes);
  if (!meses.length) return { meses: 0, erros: [] as string[] };
  const desde = meses[0];
  const ate = [ultimoDia(meses.at(-1)!), hoje].sort()[0];
  const erros: string[] = [];
  const zero = () => Object.fromEntries(meses.map((m) => [m, { gasto: 0, resultados: 0 }])) as Record<string, { gasto: number; resultados: number }>;

  // Meta: o Meta só guarda 37 meses
  const [{ data: contas }, { data: contasG }, { data: conexao }] = await Promise.all([
    banco.from("contas_anuncio").select("*").eq("cliente_id", clienteId),
    banco.from("contas_google").select("id, nome, login_customer_id, token_id").eq("cliente_id", clienteId),
    banco.from("crm_conexoes").select("*").eq("cliente_id", clienteId).maybeSingle(),
  ]);
  const meta = zero();
  let metaOk = true;
  const limiteMeta = mesDe(hoje, -36);
  for (const c of (contas ?? []) as ContaAnuncio[]) {
    try {
      const token = await tokenDaConta(c);
      if (!token) throw new Error("sem token (reconecte o Facebook)");
      const linhas = await insightsMensais(c.id, token, desde < limiteMeta ? limiteMeta : desde, ate);
      for (const l of linhas) {
        const m = meta[mesDe(l.date_start)];
        if (!m) continue;
        m.gasto += Number(l.spend ?? 0);
        const r = extrairResultados(l);
        if ((TIPOS_CONVERSAO as readonly string[]).includes(`res_${r.tipo}`)) m.resultados += r.resultados;
      }
    } catch (e) {
      metaOk = false;
      erros.push(`Meta · ${c.nome}: ${e instanceof Error ? e.message : e}`);
    }
  }

  // Google
  const google = zero();
  let googleOk = true;
  const listaG = (contasG ?? []) as { id: string; nome: string; login_customer_id: string | null; token_id: string | null }[];
  if (listaG.length) {
    const { data: tokens } = await banco.from("tokens_google").select("id, refresh_token");
    const tokenPorId = new Map((tokens ?? []).map((t) => [t.id as string, t.refresh_token as string]));
    for (const c of listaG) {
      try {
        const refresh = tokenPorId.get(c.token_id ?? "");
        if (!refresh) throw new Error("sem login do Google");
        const acesso = await tokenDeAcesso(refresh);
        for (const l of await metricasMensais(acesso, c.id, c.login_customer_id, desde, ate)) {
          const m = google[l.mes];
          if (!m) continue;
          m.gasto += l.gasto;
          m.resultados += l.conversoes;
        }
      } catch (e) {
        googleOk = false;
        erros.push(`Google · ${c.nome}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  // CRM: negócios já guardados no banco (o "Buscar histórico" sincroniza o período antes)
  const cx = conexao as (ConexaoResumo & ConexaoCrm) | null;
  const negocios = cx ? await negociosDe([clienteId], desde).catch((e) => {
    erros.push(`CRM: ${e instanceof Error ? e.message : e}`);
    return null;
  }) : null;

  const agora = new Date().toISOString();
  const linhas = meses.map((mes) => {
    const crm = cx && negocios ? numerosCrm(negocios, cx, { desde: mes, ate: ultimoDia(mes) }) : null;
    return {
      cliente_id: clienteId, mes, atualizado_em: agora,
      ...(metaOk && { gasto_meta: round(meta[mes].gasto), resultados_meta: meta[mes].resultados }),
      ...(googleOk && { gasto_google: round(google[mes].gasto), resultados_google: round(google[mes].resultados) }),
      ...(cx && negocios && {
        // funil do relatório do cliente (por padrão, só os leads de anúncio)
        crm: true, leads: crm!.funil.leads, passos: crm!.funil.passos,
        interessados: crm!.funil.passos[0]?.valor ?? null, propostas: crm!.funil.passos[1]?.valor ?? null,
        vendas: crm!.funil.vendas, faturamento: crm!.funil.faturamento,
      }),
      ...(!cx && { crm: false }),
    };
  });
  const { error } = await banco.from("historico_mensal").upsert(linhas, { onConflict: "cliente_id,mes" });
  if (error) throw new Error(/historico_mensal|relation/.test(error.message) ? `${error.message} (rode o SQL 0015 no Supabase)` : error.message);
  return { meses: linhas.length, erros };
}

const round = (v: number) => Math.round(v * 100) / 100;

/**
 * "Buscar o passado", 1ª parte: traz do CRM os negócios dos últimos `n` meses.
 * Sem consultar contatos (as UTMs não entram no histórico), para caber no tempo de uma chamada.
 */
export async function trazerCrmDoPeriodo(clienteId: string, n: number) {
  const { data: conexao } = await db().from("crm_conexoes").select("*").eq("cliente_id", clienteId).maybeSingle();
  if (!conexao) return 0;
  return sincronizarCrmCliente(conexao as ConexaoCrm, n * 31 + 5, 0);
}

/** "Buscar o passado", 2ª parte: grava os meses em blocos (cada bloco é uma chamada). */
export function blocosDeMeses(n: number, tamanho = 6) {
  const hoje = hojeISO();
  const blocos: { desde: string; ate: string }[] = [];
  for (let i = n - 1; i >= 0; i -= tamanho) {
    const desde = mesDe(hoje, -i);
    const fim = mesDe(hoje, -Math.max(i - tamanho + 1, 0));
    blocos.push({ desde, ate: fim === mesDe(hoje) ? hoje : ultimoDia(fim) });
  }
  return blocos;
}

/** Rotina diária: mês atual de todos os clientes ativos, e o mês anterior até o dia 10 (o CRM ainda anda). */
export async function atualizarHistoricoRecente() {
  const hoje = hojeISO();
  const desde = Number(hoje.slice(8, 10)) <= 10 ? mesDe(hoje, -1) : mesDe(hoje);
  const { data: clientes } = await db().from("clientes").select("id, nome").eq("ativo", true);
  const fila = [...((clientes ?? []) as { id: string; nome: string }[])];
  const erros: string[] = [];
  let meses = 0;
  async function trabalhador() {
    for (let c = fila.shift(); c; c = fila.shift()) {
      try {
        const r = await gravarHistorico(c.id, desde, hoje);
        meses += r.meses;
        erros.push(...r.erros.map((e) => `${c!.nome} · ${e}`));
      } catch (e) {
        erros.push(`${c.nome}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  await Promise.all([trabalhador(), trabalhador(), trabalhador()]);
  return { clientes: clientes?.length ?? 0, meses, erros };
}
