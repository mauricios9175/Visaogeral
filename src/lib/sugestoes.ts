import "server-only";
import { db } from "./db";
import { detalheCliente, detalheCrm, type LinhaTabela, type NumerosCrm } from "./consultas";
import { acoesDoPeriodo } from "./relatorio-slides";
import { diasEntre, resolverPeriodo, type Periodo } from "./datas";
import { decimal, dinheiro, inteiro, pct } from "./formato";
import { chaveDe, nomeDoAnuncio, nomeDoPublico } from "./agrupar";
import { perguntarIA } from "./ia";
import { CHAVE_MANUAL, chaveParams, MANUAL_PADRAO, normalizarParams, type ParamsIA } from "./manual-ia";

// Sugestões de otimização com IA: o manual do gestor + os parâmetros do cliente + os números do Meta cruzados
// com o CRM (por UTM: campanha, público e anúncio). A IA só sugere; quem executa é o gestor, pelos botões.

export async function lerManual(): Promise<string> {
  const { data } = await db().from("configuracoes").select("valor").eq("chave", CHAVE_MANUAL).maybeSingle();
  const texto = (data?.valor as { texto?: string } | null)?.texto;
  return texto?.trim() ? texto : MANUAL_PADRAO;
}

export async function lerParams(clienteId: string): Promise<ParamsIA> {
  const { data } = await db().from("configuracoes").select("valor").eq("chave", chaveParams(clienteId)).maybeSingle();
  return normalizarParams(data?.valor as Partial<ParamsIA> | null);
}

type Nivel = "anuncio" | "conjunto" | "campanha";
const ACOES = [
  "manter", "aguardar", "pausar", "escalar", "reduzir_orcamento", "otimizar_publico", "revisar_formulario",
  "novo_criativo", "recriar_campanha", "campanha_testes", "dividir_campanha", "mudar_objetivo",
] as const;
export type AcaoIA = (typeof ACOES)[number];

export type Sugestao = {
  acao: AcaoIA;
  titulo: string;
  motivo: string;
  confianca: "alta" | "media" | "baixa";
  // item do Meta a que a sugestão se refere (para os botões de pausar/orçamento)
  item: { id: string; nivel: Nivel; nome: string; conta: string; status: string | null; orcamento: LinhaTabela["orcamento"] } | null;
};

export type ResultadoSugestoes = {
  periodo: { rotulo: string; desde: string; ate: string };
  diagnostico: { cpa: string; qualidade: string; decisao: string; resumo: string };
  passo: number;
  sugestoes: Sugestao[];
  faltando: string;
};

const curto = (s: string | null | undefined, n = 70) => {
  const x = (s ?? "").replace(/\s+/g, " ").trim();
  return x.length > n ? `${x.slice(0, n - 1)}…` : x;
};

/** Qualificados de uma linha do CRM: o 1º passo do funil do relatório (ex.: "Qualificados"), senão a etapa antiga. */
const qualificadosDe = (n: NumerosCrm) => n.funil.passos[0]?.valor ?? n.qualificados;

/** Índice "nome → números do CRM" de uma dimensão de UTM (com e sem a parte do nome que o painel ignora). */
function indiceCrm(linhas: ({ nome: string } & NumerosCrm)[], normalizar: (n: string) => string) {
  const m = new Map<string, NumerosCrm>();
  for (const l of linhas) {
    if (l.nome === "(sem UTM)") continue;
    for (const k of new Set([chaveDe(l.nome), chaveDe(normalizar(l.nome))])) if (!m.has(k)) m.set(k, l);
  }
  return m;
}

function linha(l: LinhaTabela, crm: NumerosCrm | undefined, repetidos: number) {
  const meta = `gasto ${dinheiro(l.gasto)} | leads Meta ${inteiro(l.resultados)} | CPL ${dinheiro(l.cpr)} | CTR ${pct(l.ctr)} | CPM ${dinheiro(l.cpm)} | freq ${decimal(l.frequencia)}` +
    (l.orcamento ? ` | orçamento ${dinheiro(l.orcamento.valor)}/${l.orcamento.tipo}` : "");
  let c = " | CRM: sem UTM correspondente";
  if (crm) {
    const q = qualificadosDe(crm);
    const f = crm.funil;
    c = ` | CRM: ${inteiro(f.leads)} leads, ${q == null ? "qualificação não configurada" : `${inteiro(q)} qualificados (${f.leads ? Math.round((q / f.leads) * 100) : 0}%)`}, ${inteiro(f.vendas)} vendas${f.faturamento ? ` (${dinheiro(f.faturamento)})` : ""}` +
      (repetidos > 1 ? ` [CRM somado de ${repetidos} itens com o mesmo nome]` : "");
  }
  return `- id=${l.id} | ${curto(l.nome)}${l.pai ? ` [em: ${curto(l.pai, 45)}]` : ""} | status ${l.status ?? "?"} | ${meta}${c}`;
}

/** Monta o texto de dados para a IA e o mapa id → item (para ligar as sugestões aos botões). */
async function dados(clienteId: string, atual: Periodo, anterior: Periodo, params: ParamsIA) {
  const [meta, crm, acoes] = await Promise.all([
    detalheCliente(clienteId, atual, anterior),
    detalheCrm(clienteId, atual, anterior).catch(() => null),
    acoesDoPeriodo(clienteId, atual.desde, atual.ate).catch(() => [] as string[]),
  ]);
  if (!meta) throw new Error("Cliente não encontrado.");
  const c = meta.cliente;
  const a = meta.atual, b = meta.anterior;
  const dias = diasEntre(atual.desde, atual.ate);
  const mensal = c.orcamento_mensal ?? (a.gasto / dias) * 30;
  const L: string[] = [];
  L.push(`CLIENTE: ${c.nome}${c.nicho ? ` (nicho: ${c.nicho})` : ""}`);
  L.push(`PERÍODO ANALISADO: ${atual.desde} a ${atual.ate} (${dias} dias). Anterior: ${anterior.desde} a ${anterior.ate}.`);
  L.push(`FAIXA DE ORÇAMENTO: ~${dinheiro(mensal)}/mês (${c.orcamento_mensal ? "orçamento cadastrado" : "estimado pelo gasto do período"}).`);
  L.push("PARÂMETROS DO CLIENTE:");
  L.push(`- Meta de CPA: ${c.cpl_meta ? dinheiro(c.cpl_meta) : "NÃO CADASTRADA (avalie pela média da conta e avise)"}; tolerância ${params.tolerancia}% (age acima de ${c.cpl_meta ? dinheiro(c.cpl_meta * (1 + params.tolerancia / 100)) : "?"})`);
  L.push(`- Volume mínimo para julgar um anúncio: ${params.diasMinimos} dias, ${params.leadsMinimos} leads ou gasto de ${params.gastoMinimo ? dinheiro(params.gastoMinimo) : c.cpl_meta ? `${dinheiro(c.cpl_meta * 2)} (2× a meta)` : "2× o CPA médio"}`);
  L.push(`- Qualidade boa: ${params.qualificacaoMinima}% ou mais dos leads qualificados no CRM`);
  if (params.notas.trim()) L.push(`- Observações do gestor sobre este cliente: ${params.notas.trim()}`);

  L.push("", "== CONTA NO META (período vs anterior) ==");
  L.push(`Gasto ${dinheiro(a.gasto)} (antes ${dinheiro(b.gasto)}) | leads ${inteiro(a.resultados)} (antes ${inteiro(b.resultados)}) | CPL ${dinheiro(a.cpr)} (antes ${dinheiro(b.cpr)}) | CTR ${pct(a.ctr)} | CPM ${dinheiro(a.cpm)} | freq ${decimal(a.frequencia)}`);

  if (crm) {
    const q = qualificadosDe(crm.atual);
    const qa = qualificadosDe(crm.anterior);
    const f = crm.atual.funil;
    const passo = crm.nomesFunil.passos[0] ?? "Qualificados";
    L.push("", "== CRM (funil do relatório) ==");
    L.push(`Qualificado = chegou na etapa "${passo}" ou depois. ${crm.nomesFunil.leads}: ${inteiro(f.leads)} (antes ${inteiro(crm.anterior.funil.leads)}) | ${passo}: ${q == null ? "não configurado" : `${inteiro(q)} = ${f.leads ? Math.round((q / f.leads) * 100) : 0}%`} (antes ${qa == null ? "?" : inteiro(qa)}) | vendas ${inteiro(f.vendas)} | faturamento ${dinheiro(f.faturamento)}`);
    f.passos.slice(1).forEach((p) => L.push(`- ${p.nome}: ${inteiro(p.valor)}`));
    if (crm.motivosPerda.total) L.push(`Perdidos: ${crm.motivosPerda.total} — ${crm.motivosPerda.lista.slice(0, 6).map((m) => `${curto(m.motivo, 40)} (${m.total})`).join("; ")}`);
    if (!crm.temUtm) L.push("ATENÇÃO: os leads do CRM não têm UTM; não dá para cruzar a qualidade por anúncio/conjunto, só no total.");
  } else {
    L.push("", "== CRM ==", "Cliente sem CRM conectado: não há dados de qualidade. Avalie só pelo custo e avise que falta a qualidade.");
  }

  const porAnuncio = crm ? indiceCrm(crm.porUtm.utm_content, nomeDoAnuncio) : new Map<string, NumerosCrm>();
  const porConjunto = crm ? indiceCrm(crm.porUtm.utm_medium, nomeDoPublico) : new Map<string, NumerosCrm>();
  const porCampanha = crm ? indiceCrm(crm.porUtm.utm_campaign, (n) => n) : new Map<string, NumerosCrm>();
  const contar = (ls: LinhaTabela[], norm: (n: string) => string) => {
    const m = new Map<string, number>();
    for (const l of ls) m.set(chaveDe(norm(l.nome)), (m.get(chaveDe(norm(l.nome))) ?? 0) + 1);
    return m;
  };
  const achar = (idx: Map<string, NumerosCrm>, l: LinhaTabela, norm: (n: string) => string) => idx.get(chaveDe(l.nome)) ?? idx.get(chaveDe(norm(l.nome)));

  const itens = new Map<string, Sugestao["item"]>();
  const bloco = (titulo: string, nivel: Nivel, ls: LinhaTabela[], idx: Map<string, NumerosCrm>, norm: (n: string) => string, max: number) => {
    const comGasto = ls.filter((l) => l.gasto > 0).slice(0, max);
    if (!comGasto.length) return;
    const rep = contar(comGasto, norm);
    L.push("", `== ${titulo} (maior gasto primeiro) ==`);
    for (const l of comGasto) {
      itens.set(l.id, { id: l.id, nivel, nome: l.nome, conta: l.conta, status: l.status, orcamento: l.orcamento });
      L.push(linha(l, achar(idx, l, norm), rep.get(chaveDe(norm(l.nome))) ?? 1));
    }
  };
  bloco("CAMPANHAS", "campanha", meta.campanhas, porCampanha, (n) => n, 10);
  bloco("CONJUNTOS", "conjunto", meta.conjuntos, porConjunto, nomeDoPublico, 15);
  bloco("ANÚNCIOS", "anuncio", meta.anuncios, porAnuncio, nomeDoAnuncio, 25);

  if (acoes.length) L.push("", "== AÇÕES JÁ FEITAS NO PERÍODO (não repetir; respeitar o tempo de reavaliação) ==", ...acoes.map((t) => `- ${t}`));
  return { texto: L.join("\n"), itens };
}

const FORMATO = `Responda SÓ com um JSON neste formato:
{
  "diagnostico": {
    "cpa": "dentro" | "acima" | "sem_meta",
    "qualidade": "boa" | "ruim" | "sem_dados",
    "decisao": "manter" | "otimizar_custo" | "otimizar_qualidade" | "prioridade_maxima" | "aguardar",
    "resumo": "2 a 3 frases com o diagnóstico da conta, citando os números"
  },
  "passo": número do passo do manual em que a otimização está (0 = nada a fazer),
  "sugestoes": [
    {
      "id": "id exato do item da lista (campanha, conjunto ou anúncio), ou vazio se for algo da conta toda",
      "acao": ${ACOES.map((a) => `"${a}"`).join(" | ")},
      "titulo": "frase curta com a ação (ex.: Desativar o anúncio X)",
      "motivo": "por quê, com os números do Meta E do CRM, citando a regra do manual",
      "confianca": "alta" | "media" | "baixa"
    }
  ],
  "faltando": "dados que faltaram para decidir melhor (ou vazio)"
}

Regras de resposta:
- Siga o manual do gestor à risca e na ordem dos passos. Não pule etapas: só sugira mexer em conjunto se nenhum anúncio está bom; só sugira recriar campanha se nem anúncios nem conjuntos funcionam.
- Se a conta está dentro da meta e com qualidade boa, a resposta é manter: devolva no máximo 1 a 2 sugestões (ex.: escalar um anúncio barato e qualificado), ou nenhuma.
- Item sem o volume mínimo: "aguardar" (ou não cite), nunca pausar.
- Use os ids exatamente como aparecem na lista. Ordene por prioridade. No máximo 8 sugestões.
- Não invente números. Português do Brasil, direto.`;

/** Sugestões de otimização do cliente (padrão: últimos 14 dias, para ter volume). */
export async function sugerirOtimizacoes(clienteId: string, params?: { p?: string; de?: string; ate?: string }): Promise<ResultadoSugestoes> {
  const { atual, anterior } = resolverPeriodo(params?.p ? params : { p: "14" });
  const [manual, prm] = await Promise.all([lerManual(), lerParams(clienteId)]);
  const { texto, itens } = await dados(clienteId, atual, anterior, prm);
  const sistema = `Você é a IA de otimização de campanhas de um gestor de tráfego no Brasil. Você recebe o MANUAL DO GESTOR (as regras dele), os parâmetros do cliente e os números do Meta Ads cruzados com o CRM. Decida o que fazer seguindo o manual.\n\n=== MANUAL DO GESTOR ===\n${manual}\n=== FIM DO MANUAL ===\n\n${FORMATO}`;
  const bruto = await perguntarIA(sistema, texto, { json: true, temperatura: 0.3 });
  let r: { diagnostico?: Partial<ResultadoSugestoes["diagnostico"]>; passo?: number; sugestoes?: { id?: string; acao?: string; titulo?: string; motivo?: string; confianca?: string }[]; faltando?: string };
  try {
    r = JSON.parse(bruto.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new Error("A IA respondeu num formato inesperado. Tente de novo.");
  }
  return {
    periodo: { rotulo: atual.rotulo, desde: atual.desde, ate: atual.ate },
    diagnostico: {
      cpa: String(r.diagnostico?.cpa ?? ""), qualidade: String(r.diagnostico?.qualidade ?? ""),
      decisao: String(r.diagnostico?.decisao ?? ""), resumo: String(r.diagnostico?.resumo ?? "").slice(0, 1200),
    },
    passo: Math.max(0, Math.min(5, Math.round(Number(r.passo) || 0))),
    faltando: String(r.faltando ?? "").slice(0, 600),
    sugestoes: (r.sugestoes ?? []).slice(0, 8).map((s) => ({
      acao: (ACOES as readonly string[]).includes(String(s.acao)) ? (s.acao as AcaoIA) : "manter",
      titulo: String(s.titulo ?? "").slice(0, 200),
      motivo: String(s.motivo ?? "").slice(0, 800),
      confianca: (s.confianca === "alta" || s.confianca === "baixa" ? s.confianca : "media") as Sugestao["confianca"],
      item: (s.id && itens.get(String(s.id).trim())) || null,
    })).filter((s) => s.titulo),
  };
}
