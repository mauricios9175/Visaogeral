import "server-only";
import { briefingDoCliente } from "./ficha";
import { db } from "./db";
import { detalheCliente, detalheCrm, ROTULO_TIPO, TIPOS_CONVERSAO, type Derivadas, type LinhaTabela } from "./consultas";
import { detalheGoogle, type NumerosGoogle } from "./consultas-google";
import { acoesDoPeriodo } from "./relatorio-slides";
import { diasEntre, hojeISO, resolverPeriodo, somarDias, type Periodo } from "./datas";
import { decimal, dinheiro, inteiro, pct } from "./formato";
import { perguntarIA } from "./ia";
import { normalizarFunil } from "./funil";

// ---------- Entender o pedido: "analisa os últimos 14 dias da Loja X" ----------

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
// palavras que aparecem em muitos nomes de cliente e não ajudam a escolher um
const GENERICAS = new Set(["loja", "lojas", "clinica", "studio", "estudio", "grupo", "empresa", "comercio", "moveis", "the", "dos", "das", "com"]);

type ClienteBasico = { id: string; nome: string };

/** Acha o cliente citado no texto. Empate ou nenhum: erro com as opções. */
export function acharCliente(texto: string, clientes: ClienteBasico[]): ClienteBasico {
  const t = ` ${sem(texto).replace(/[^a-z0-9]+/g, " ")} `;
  const pontos = clientes.map((c) => {
    const nome = sem(c.nome).replace(/[^a-z0-9]+/g, " ").trim();
    if (nome && t.includes(` ${nome} `)) return { c, p: 1000 + nome.length };
    const palavras = nome.split(" ").filter((w) => w.length >= 3 && !GENERICAS.has(w));
    return { c, p: palavras.filter((w) => t.includes(` ${w} `)).reduce((s, w) => s + w.length, 0) };
  }).filter((x) => x.p > 0).sort((a, b) => b.p - a.p);
  if (!pontos.length) throw new Error("Não achei o cliente no pedido. Escreva o nome dele (ex.: “últimos 14 dias da Loja X”).");
  const empatados = pontos.filter((x) => x.p === pontos[0].p);
  if (empatados.length > 1) throw new Error(`Fiquei em dúvida entre ${empatados.map((x) => x.c.nome).join(", ")}. Escreva o nome completo.`);
  return pontos[0].c;
}

const ultimoDia = (a: number, m: number) => new Date(Date.UTC(a, m, 0)).getUTCDate();
const iso = (a: number, m: number, d: number) => `${a}-${String(m).padStart(2, "0")}-${String(Math.min(d, ultimoDia(a, m))).padStart(2, "0")}`;

/** Parâmetros de período (os mesmos da URL: p, de, ate) a partir do texto. Sem período no texto: 7 dias. */
export function periodoDoTexto(texto: string): { p: string; de?: string; ate?: string } {
  const t = sem(texto);
  const hoje = hojeISO();
  const [ah, mh] = hoje.split("-").map(Number);
  const livre = (de: string, ate: string) => ({ p: "livre", de, ate: ate > hoje ? hoje : ate });

  // "do dia 1 ao dia 15", "de 01/10 a 15/10", "1/9/2026 até 30/9/2026"
  const d = /(?:dia\s+)?(\d{1,2})(?:\/(\d{1,2}))?(?:\/(\d{2,4}))?\s+(?:a|ate|ao|e)\s+(?:o\s+)?(?:dia\s+)?(\d{1,2})(?:\/(\d{1,2}))?(?:\/(\d{2,4}))?/.exec(t);
  if (d && (/dia|\//.test(d[0]))) {
    const ano = (x?: string) => (x ? (x.length === 2 ? 2000 + Number(x) : Number(x)) : null);
    let m2 = d[5] ? Number(d[5]) : mh;
    let a2 = ano(d[6]) ?? ah;
    // "dia 20 ao dia 5" sem mês: começa no mês anterior
    let m1 = d[2] ? Number(d[2]) : (Number(d[1]) > Number(d[4]) ? m2 - 1 : m2);
    let a1 = ano(d[3]) ?? a2;
    if (m1 < 1) { m1 = 12; a1--; }
    // sem mês e ainda não chegou nesse dia: é do mês passado
    if (!d[5] && iso(a2, m2, Number(d[4])) > hoje) { m2--; m1--; if (m2 < 1) { m2 = 12; a2--; } if (m1 < 1) { m1 = 12; a1--; } }
    if (!d[6] && iso(a2, m2, Number(d[4])) > hoje) { a1--; a2--; }
    if (m1 >= 1 && m1 <= 12 && m2 >= 1 && m2 <= 12) return livre(iso(a1, m1, Number(d[1])), iso(a2, m2, Number(d[4])));
  }

  const n = /(\d{1,3})\s*dias/.exec(t);
  if (n) {
    const dias = Math.min(Math.max(Number(n[1]), 1), 365);
    if ([7, 14, 30].includes(dias)) return { p: String(dias) };
    const ontem = somarDias(hoje, -1);
    return livre(somarDias(ontem, -(dias - 1)), ontem);
  }
  if (/\bontem\b/.test(t)) return { p: "ontem" };
  if (/\bhoje\b/.test(t)) return { p: "hoje" };
  if (/mes passado|ultimo mes/.test(t)) return { p: "mes_passado" };
  if (/(este|esse|neste|nesse) mes/.test(t)) return { p: "mes" };
  if (/semana passada|ultima semana/.test(t)) return { p: "7" };
  if (/quinzena/.test(t)) return { p: "14" };
  // nome de mês: o mais recente que já começou ("outubro" em novembro = outubro deste ano)
  const mes = MESES.findIndex((x) => new RegExp(`\\b${x}\\b`).test(t));
  if (mes >= 0) {
    const a = mes + 1 > mh ? ah - 1 : ah;
    return livre(iso(a, mes + 1, 1), iso(a, mes + 1, 31));
  }
  return { p: "7" };
}

// ---------- Juntar os números do cliente num texto curto para a IA ----------

const varia = (a: number | null | undefined, b: number | null | undefined) => {
  if (a == null || b == null || !b) return "";
  const v = ((a - b) / Math.abs(b)) * 100;
  return ` (${v >= 0 ? "+" : ""}${v.toFixed(0)}% vs anterior)`;
};
const curto = (s: string | null | undefined, n = 70) => {
  const x = (s ?? "").replace(/\s+/g, " ").trim();
  return x.length > n ? `${x.slice(0, n - 1)}…` : x;
};

function tiposDeResultado(m: Derivadas) {
  return TIPOS_CONVERSAO.filter((k) => m[k] > 0).map((k) => `${inteiro(m[k])} ${ROTULO_TIPO[k]}`).join(", ") || "nenhum";
}

function linhaMeta(l: LinhaTabela) {
  return `- ${curto(l.nome)}${l.pai ? ` [em: ${curto(l.pai, 40)}]` : ""} | status ${l.status ?? "?"} | gasto ${dinheiro(l.gasto)} | resultados ${inteiro(l.resultados)}` +
    ` | custo/resultado ${dinheiro(l.cpr)} | CTR ${pct(l.ctr)} | CPM ${dinheiro(l.cpm)} | freq ${decimal(l.frequencia)}` +
    (l.orcamento ? ` | orçamento ${dinheiro(l.orcamento.valor)}/${l.orcamento.tipo}` : "");
}

const blocoGoogle = (g: NumerosGoogle) =>
  `gasto ${dinheiro(g.gasto)} | conversões ${decimal(g.conversoes)} | CPA ${dinheiro(g.cpa)} | cliques ${inteiro(g.cliques)} | CTR ${pct(g.ctr)} | CPC ${dinheiro(g.cpc)}` +
  (g.roas != null ? ` | ROAS ${decimal(g.roas)}` : "");

/** Os números do período em texto. Só números e nomes de campanhas: nenhum dado pessoal de lead. */
export async function dadosDoPeriodo(clienteId: string, atual: Periodo, anterior: Periodo) {
  const [meta, crm, google, acoes, briefing] = await Promise.all([
    detalheCliente(clienteId, atual, anterior),
    detalheCrm(clienteId, atual, anterior).catch(() => null),
    detalheGoogle(clienteId, atual, anterior).catch(() => null),
    acoesDoPeriodo(clienteId, atual.desde, atual.ate).catch(() => [] as string[]),
    briefingDoCliente(clienteId).catch(() => ""),
  ]);
  if (!meta) throw new Error("Cliente não encontrado.");
  const c = meta.cliente;
  const L: string[] = [];
  L.push(`CLIENTE: ${c.nome}${c.nicho ? ` (nicho: ${c.nicho})` : ""}`);
  if (briefing) L.push(`BRIEFING DO CLIENTE (escrito pelo gestor):\n${briefing.slice(0, 3000)}`);
  L.push(`PERÍODO: ${atual.desde} a ${atual.ate} (${diasEntre(atual.desde, atual.ate)} dias). Comparação: ${anterior.desde} a ${anterior.ate}.`);
  const metas = [
    c.cpl_meta && `custo por resultado alvo ${dinheiro(c.cpl_meta)}`,
    c.orcamento_mensal && `orçamento mensal ${dinheiro(c.orcamento_mensal)}`,
    c.roas_meta && `ROAS alvo ${decimal(c.roas_meta)}`,
  ].filter(Boolean);
  L.push(`METAS: ${metas.join("; ") || "não cadastradas"}`);

  const a = meta.atual, b = meta.anterior;
  if (a.gasto > 0 || b.gasto > 0) {
    L.push("", "== META ADS ==");
    L.push(`Gasto ${dinheiro(a.gasto)}${varia(a.gasto, b.gasto)}`);
    L.push(`Resultados ${inteiro(a.resultados)}${varia(a.resultados, b.resultados)} — tipos: ${tiposDeResultado(a)}`);
    L.push(`Custo por resultado ${dinheiro(a.cpr)}${varia(a.cpr, b.cpr)} (anterior ${dinheiro(b.cpr)})`);
    L.push(`CTR link ${pct(a.ctr)}${varia(a.ctr, b.ctr)} | CPM ${dinheiro(a.cpm)}${varia(a.cpm, b.cpm)} | CPC ${dinheiro(a.cpc)}${varia(a.cpc, b.cpc)} | frequência ~${decimal(a.frequencia)}`);
    if (a.compras > 0) L.push(`Compras ${inteiro(a.compras)} | valor ${dinheiro(a.valor_compras)} | ROAS ${decimal(a.roas)}`);
    if (meta.serie.length > 1) L.push(`Por dia (gasto/resultados): ${meta.serie.map((d) => `${d.data.slice(8)}/${d.data.slice(5, 7)} ${Math.round(d.gasto)}/${d.resultados}`).join("; ")}`);
    L.push("Campanhas (maior gasto primeiro):", ...meta.campanhas.slice(0, 8).map(linhaMeta));
    L.push("Conjuntos:", ...meta.conjuntos.slice(0, 10).map(linhaMeta));
    L.push("Anúncios:", ...meta.anuncios.slice(0, 12).map(linhaMeta));
  } else {
    L.push("", "== META ADS ==", "Sem gasto no período nem no anterior.");
  }

  if (google && (google.atual.gasto > 0 || google.anterior.gasto > 0)) {
    L.push("", "== GOOGLE ADS ==");
    L.push(`Atual: ${blocoGoogle(google.atual)}`);
    L.push(`Anterior: ${blocoGoogle(google.anterior)}`);
    L.push("Campanhas:", ...google.campanhas.slice(0, 8).map((x) => `- ${curto(x.nome)} (${x.canal ?? "?"}, ${x.status ?? "?"}) | ${blocoGoogle(x)}`));
    if (google.porAcao.length) L.push(`Conversões por ação: ${google.porAcao.slice(0, 6).map(([n, q]) => `${curto(n, 40)} ${decimal(q)}`).join("; ")}`);
  }

  if (crm) {
    const x = crm.atual, y = crm.anterior;
    const f = x.funil, fy = y.funil;
    L.push("", "== CRM ==");
    L.push(`Funil do relatório (${normalizarFunil(crm.conexao.funil).soAnuncio ? "só leads de anúncio" : "todos os leads"}):`);
    L.push(`- ${crm.nomesFunil.leads}: ${inteiro(f.leads)}${varia(f.leads, fy.leads)}`);
    f.passos.forEach((p, i) => L.push(`- ${p.nome}: ${inteiro(p.valor)}${varia(p.valor, fy.passos[i]?.valor)}`));
    L.push(`- ${crm.nomesFunil.vendas}: ${inteiro(f.vendas)}${varia(f.vendas, fy.vendas)} | faturamento ${dinheiro(f.faturamento)}${varia(f.faturamento, fy.faturamento)}`);
    if (f.valorPropostas) L.push(`- Valor das propostas no funil: ${dinheiro(f.valorPropostas)}`);
    L.push(`Total do CRM (todas as fontes): ${inteiro(x.leads)} leads, ${inteiro(x.vendas)} vendas, ${dinheiro(x.faturamento)}; em negociação ${dinheiro(x.emNegociacao)}`);
    const investido = a.gasto + (google?.atual.gasto ?? 0);
    if (investido > 0 && f.leads) L.push(`Custo por lead do CRM ${dinheiro(investido / f.leads)}${f.vendas ? ` | custo por venda ${dinheiro(investido / f.vendas)}` : ""}${f.faturamento ? ` | ROAS do CRM ${decimal(f.faturamento / investido)}` : ""}`);
    if (crm.motivosPerda.total) L.push(`Perdidos no período: ${crm.motivosPerda.total} — motivos: ${crm.motivosPerda.lista.slice(0, 6).map((m) => `${curto(m.motivo, 40)} (${m.total})`).join("; ")}`);
    if (crm.porFonte.length) L.push(`Por fonte: ${crm.porFonte.slice(0, 6).map((g) => `${curto(g.nome, 30)}${g.anuncio ? " [anúncio]" : ""} ${g.leads} leads/${g.vendas} vendas`).join("; ")}`);
    if (crm.temUtm) {
      for (const [chave, rotulo] of [["utm_campaign", "Campanha"], ["utm_medium", "Público"], ["utm_content", "Anúncio"]] as const) {
        const linhas = crm.porUtm[chave].filter((u) => u.nome !== "(sem UTM)").slice(0, 6);
        if (linhas.length) L.push(`Leads do CRM por ${rotulo} (UTM): ${linhas.map((u) => `${curto(u.nome, 50)} ${u.leads} leads/${u.vendas} vendas${u.faturamento ? `/${dinheiro(u.faturamento)}` : ""}`).join("; ")}`);
      }
    }
  }

  if (acoes.length) L.push("", "== AÇÕES FEITAS NO PERÍODO ==", ...acoes.map((t) => `- ${t}`));
  return { cliente: c, texto: L.join("\n") };
}

const SISTEMA = `Você é um gestor de tráfego sênior no Brasil. Vai analisar os números de um cliente para outro gestor de tráfego (o dono do painel), que conhece Meta Ads, Google Ads e CRM.

Regras:
- Português do Brasil, direto e profissional, sem enrolação. Valores em R$.
- Use só os números fornecidos. Não invente dados; se faltar algo importante, diga em uma linha.
- Compare com o período anterior e com as metas. Variação com pouco volume (ex.: 2 → 4 leads) não é significativa: avise em vez de tirar conclusão.
- Cite campanhas, conjuntos e anúncios pelo nome quando ajudar.
- Cruze mídia com CRM: lead barato que não vira venda, anúncio que traz venda, motivos de perda que indicam público ou abordagem.
- Formato em markdown simples, com estas seções:
## Resumo
(2 a 3 frases com o principal do período)
## O que foi bem
## O que precisa de atenção
## Próximos passos
(3 a 5 ações concretas, em ordem de prioridade)
- Use listas com "- ". No máximo uns 350 palavras.`;

/** Análise em texto de um cliente num período. */
export async function analisarPeriodo(clienteId: string, params: { p?: string; de?: string; ate?: string }) {
  const { atual, anterior } = resolverPeriodo(params);
  const { cliente, texto } = await dadosDoPeriodo(clienteId, atual, anterior);
  const analise = await perguntarIA(SISTEMA, `Analise este período.\n\n${texto}`);
  return { cliente: { id: cliente.id, nome: cliente.nome }, periodo: { rotulo: atual.rotulo, desde: atual.desde, ate: atual.ate, qs: atual.qs }, texto: analise };
}

/** O pedido é para montar campanha (e não para analisar)? */
export function ehPedidoDeCampanha(texto: string) {
  const t = sem(texto);
  return /\b(campanha|esboco|rascunho|mont[ae]r?|cri[ae]r?|anuncio)\b/.test(t) && !/\banalis|\bresum|\brelatorio|como (foi|esta|ta)|desempenho|ultim[oa]s? \d+|mes passado/.test(t);
}

/** Cliente citado no pedido (entre os ativos). */
export async function clienteDoPedido(pedido: string) {
  const { data } = await db().from("clientes").select("id, nome").eq("ativo", true);
  return acharCliente(pedido, (data ?? []) as ClienteBasico[]);
}

/** Pedido livre ("análise dos últimos 14 dias da Loja X"): acha o cliente (se não veio) e o período, e analisa. */
export async function analisarPedido(pedido: string, clienteId?: string) {
  const id = clienteId ?? (await clienteDoPedido(pedido)).id;
  return analisarPeriodo(id, periodoDoTexto(pedido));
}
