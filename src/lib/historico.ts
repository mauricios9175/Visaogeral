import "server-only";
import { db, type ContaAnuncio } from "./db";
import { extrairResultados, insightsMensais } from "./meta";
import { metricasMensais, tokenDeAcesso } from "./google";
import { tokenDaConta } from "./sync";
import { sincronizarCrmCliente, type ConexaoCrm } from "./crm/sync";
import { negociosDe, numerosCrm, TIPOS_CONVERSAO, type ConexaoResumo } from "./consultas";
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
  interessados: number | null;
  propostas: number | null;
  vendas: number | null;
  faturamento: number | null;
  ajustes: Partial<Record<CampoAjustavel, number>> | null;
  observacao: string | null;
  atualizado_em: string;
};

/** Campos que dá para corrigir à mão (vazio = usa o número automático). */
export const CAMPOS_AJUSTAVEIS = ["investimento", "leads", "interessados", "propostas", "vendas", "faturamento"] as const;
export type CampoAjustavel = (typeof CAMPOS_AJUSTAVEIS)[number];

/** Como cada cliente chama as etapas do funil (configurado na tela do CRM). */
export type Rotulos = { leads: string; interessados: string; propostas: string; vendas: string };
export const ROTULOS_PADRAO: Rotulos = { leads: "Leads", interessados: "Interessados", propostas: "Propostas", vendas: "Vendas" };

/** Mês com os números finais (ajustes manuais aplicados) e as taxas da planilha. */
export type MesConsolidado = {
  mes: string;
  investimento: number;
  gastoMeta: number;
  gastoGoogle: number;
  leads: number | null;
  interessados: number | null;
  propostas: number | null;
  vendas: number | null;
  faturamento: number | null;
  taxaQualificacao: number | null; // interessados / leads
  taxaPropostas: number | null;    // propostas / interessados
  conversaoVendas: number | null;  // vendas / propostas (ou / interessados, sem etapa de propostas)
  roas: number | null;
  cpl: number | null;
  cplQualificado: number | null;
  ajustado: CampoAjustavel[];
  observacao: string | null;
  crm: boolean;
};

const div = (a: number | null, b: number | null) => (a != null && b ? a / b : null);

export function consolidar(l: LinhaHistorico): MesConsolidado {
  const aj = l.ajustes ?? {};
  const investimento = aj.investimento ?? Number(l.gasto_meta) + Number(l.gasto_google);
  // sem CRM, "leads" são os resultados das plataformas (formulários, conversas…)
  const leads = aj.leads ?? (l.crm ? l.leads : Math.round(Number(l.resultados_meta) + Number(l.resultados_google)));
  const interessados = aj.interessados ?? l.interessados;
  const propostas = aj.propostas ?? l.propostas;
  const vendas = aj.vendas ?? l.vendas;
  const faturamento = aj.faturamento ?? (l.faturamento == null ? null : Number(l.faturamento));
  return {
    mes: l.mes,
    investimento,
    gastoMeta: Number(l.gasto_meta),
    gastoGoogle: Number(l.gasto_google),
    leads, interessados, propostas, vendas, faturamento,
    taxaQualificacao: div(interessados, leads),
    taxaPropostas: div(propostas, interessados),
    conversaoVendas: propostas != null ? div(vendas, propostas) : div(vendas, interessados),
    roas: faturamento ? div(faturamento, investimento) : null,
    cpl: div(investimento, leads),
    cplQualificado: div(investimento, interessados),
    ajustado: CAMPOS_AJUSTAVEIS.filter((c) => aj[c] != null),
    observacao: l.observacao,
    crm: l.crm,
  };
}

/** Soma vários meses (para o total do período) e recalcula as taxas. */
export function somarMeses(meses: MesConsolidado[]): MesConsolidado | null {
  if (!meses.length) return null;
  const soma = (k: "leads" | "interessados" | "propostas" | "vendas" | "faturamento") =>
    meses.some((m) => m[k] != null) ? meses.reduce((t, m) => t + (m[k] ?? 0), 0) : null;
  const linha: LinhaHistorico = {
    cliente_id: "", mes: "total", crm: true, ajustes: null, observacao: null, atualizado_em: "",
    gasto_meta: meses.reduce((t, m) => t + m.gastoMeta, 0), gasto_google: meses.reduce((t, m) => t + m.gastoGoogle, 0),
    resultados_meta: 0, resultados_google: 0,
    leads: soma("leads"), interessados: soma("interessados"), propostas: soma("propostas"), vendas: soma("vendas"), faturamento: soma("faturamento"),
  };
  // investimento pode ter ajuste manual em algum mês: soma o valor final de cada mês
  return { ...consolidar({ ...linha, ajustes: { investimento: meses.reduce((t, m) => t + m.investimento, 0) } }), ajustado: [] };
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
  return { meses: ((data ?? []) as LinhaHistorico[]).map(consolidar), erro: null };
}

export async function rotulosDoCliente(clienteId: string): Promise<Rotulos> {
  const { data } = await db().from("crm_conexoes").select("rotulos").eq("cliente_id", clienteId).maybeSingle();
  return { ...ROTULOS_PADRAO, ...((data?.rotulos as Partial<Rotulos> | null) ?? {}) };
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
        crm: true, leads: crm!.leads, interessados: crm!.qualificados, propostas: crm!.propostas,
        vendas: crm!.vendas, faturamento: crm!.faturamento,
      }),
      ...(!cx && { crm: false }),
    };
  });
  const { error } = await banco.from("historico_mensal").upsert(linhas, { onConflict: "cliente_id,mes" });
  if (error) throw new Error(/historico_mensal|relation/.test(error.message) ? `${error.message} (rode o SQL 0015 no Supabase)` : error.message);
  return { meses: linhas.length, erros };
}

const round = (v: number) => Math.round(v * 100) / 100;

/** "Buscar histórico": traz do CRM os negócios do período inteiro e grava os últimos `n` meses. */
export async function preencherHistorico(clienteId: string, n: number) {
  const hoje = hojeISO();
  const erros: string[] = [];
  const { data: conexao } = await db().from("crm_conexoes").select("*").eq("cliente_id", clienteId).maybeSingle();
  if (conexao) {
    try {
      await sincronizarCrmCliente(conexao as ConexaoCrm, n * 31 + 5);
    } catch (e) {
      erros.push(`CRM: ${e instanceof Error ? e.message : e}`);
    }
  }
  const r = await gravarHistorico(clienteId, mesDe(hoje, -(n - 1)), hoje);
  return { meses: r.meses, erros: [...erros, ...r.erros] };
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
