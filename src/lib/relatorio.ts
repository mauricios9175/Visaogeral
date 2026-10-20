import "server-only";
import { db, EMPRESA_PADRAO, type Cliente, type ContaAnuncio } from "./db";
import { buscarTudo, resumoCrm } from "./consultas";
import { dataBRCurta, periodoRelatorio } from "./datas";
import { dinheiro, inteiro, pct } from "./formato";
import { alcanceDaConta, linkDoCriativo } from "./meta";
import { tokenDaConta } from "./sync";

export type TipoRelatorio = "semanal" | "parcial";

type Linha = {
  conta_id: string; data: string; ad_id: string; ad_nome: string | null;
  gasto: number; impressoes: number; cliques_link: number; resultados: number; resultado_tipo: string | null;
  leads: number; conversas: number; valor_compras: number;
};

// Como cada tipo de resultado aparece na mensagem.
const TIPOS = {
  conversas: { emoji: "💬", nome: "Conversas iniciadas", custo: "📲 Custo por conversa", frase: "conversa(s) iniciada(s) no WhatsApp", curto: "conversa(s)" },
  formulario: { emoji: "🎯", nome: "Leads (formulário)", custo: "💎 Custo por lead", frase: "lead(s) de formulário", curto: "lead(s)" },
  lead_site: { emoji: "🎯", nome: "Leads no site", custo: "💎 Custo por lead", frase: "lead(s) no site", curto: "lead(s)" },
  conv_personalizada: { emoji: "✅", nome: "Conversões no site", custo: "💎 Custo por conversão", frase: "conversão(ões) no site", curto: "conversão(ões)" },
  compras: { emoji: "🛒", nome: "Compras", custo: "💎 Custo por compra", frase: "compra(s)", curto: "compra(s)" },
  cadastro: { emoji: "🧾", nome: "Cadastros", custo: "💎 Custo por cadastro", frase: "cadastro(s)", curto: "cadastro(s)" },
} as const;
type Tipo = keyof typeof TIPOS;

/** Linhas antigas, sem tipo, contam conversas e leads como antes. */
function tipoDaLinha(l: Linha): { tipo: Tipo | null; qtd: number }[] {
  if (l.resultado_tipo) {
    return l.resultado_tipo in TIPOS ? [{ tipo: l.resultado_tipo as Tipo, qtd: Number(l.resultados) }] : [];
  }
  return [{ tipo: "conversas", qtd: Number(l.conversas) }, { tipo: "lead_site", qtd: Number(l.leads) }];
}

function resumir(linhas: Linha[]) {
  const porTipo = new Map<Tipo, { qtd: number; gasto: number }>();
  const porAnuncio = new Map<string, { nome: string; gasto: number; qtd: number; tipo: Tipo | null }>();
  let gasto = 0, impressoes = 0, cliques = 0;
  for (const l of linhas) {
    gasto += Number(l.gasto); impressoes += Number(l.impressoes); cliques += Number(l.cliques_link);
    const a = porAnuncio.get(l.ad_id) ?? { nome: l.ad_nome ?? "Anúncio", gasto: 0, qtd: 0, tipo: null };
    a.gasto += Number(l.gasto);
    for (const { tipo, qtd } of tipoDaLinha(l)) {
      if (!tipo) continue;
      const t = porTipo.get(tipo) ?? { qtd: 0, gasto: 0 };
      t.qtd += qtd;
      t.gasto += Number(l.gasto); // gasto das campanhas desse objetivo → custo por resultado do tipo
      porTipo.set(tipo, t);
      a.qtd += qtd;
      if (qtd > 0 || !a.tipo) a.tipo = tipo;
    }
    porAnuncio.set(l.ad_id, a);
  }
  const resultados = [...porTipo.values()].reduce((s, t) => s + t.qtd, 0);
  const cprGeral = resultados ? gasto / resultados : null;
  const anuncios = [...porAnuncio.entries()].map(([id, a]) => ({ id, ...a }));
  const destaque = anuncios.filter((a) => a.qtd > 0).sort((x, y) => y.qtd - x.qtd || x.gasto - y.gasto)[0] ?? null;
  // precisa de revisão: gastou bem acima do custo médio sem resultado, ou custo 60% acima da média
  const revisar = anuncios.filter((a) =>
    cprGeral != null &&
    ((a.qtd === 0 && a.gasto >= Math.max(30, cprGeral * 1.5)) || (a.qtd > 0 && a.gasto / a.qtd > cprGeral * 1.6 && a.gasto >= 30)),
  );
  return { gasto, impressoes, cliques, ctr: impressoes ? (cliques / impressoes) * 100 : null, porTipo, resultados, cprGeral, destaque, revisar };
}

const custo = (t?: { qtd: number; gasto: number }) => (t && t.qtd ? t.gasto / t.qtd : null);

function montarTexto(p: {
  tipo: TipoRelatorio;
  periodo: { desde: string; ate: string };
  atual: ReturnType<typeof resumir>;
  anterior: ReturnType<typeof resumir>;
  alcance: number | null;
  link: string | null;
  crm: { leads: number; qualificados: number | null; vendas: number; faturamento: number } | null;
}) {
  const { atual: a, anterior: b } = p;
  const linhas: string[] = [];
  const semanal = p.tipo === "semanal";
  const comparacao = {
    melhor: semanal ? "melhor que na semana anterior" : "melhor que nos mesmos dias da semana passada",
    pior: semanal ? "acima da semana anterior" : "acima dos mesmos dias da semana passada",
    igual: semanal ? "estável em relação à semana anterior" : "estável em relação aos mesmos dias da semana passada",
  };
  linhas.push(
    p.tipo === "semanal"
      ? `Olá! Desejo uma ótima semana. Seguem os resultados da semana anterior (${dataBRCurta(p.periodo.desde)} a ${dataBRCurta(p.periodo.ate)}):`
      : `Olá! Segue a parcial da semana, de segunda (${dataBRCurta(p.periodo.desde)}) até agora:`,
    "",
  );
  if (a.gasto === 0) {
    linhas.push("Não houve veiculação de anúncios neste período.");
    return linhas.join("\n");
  }
  linhas.push(`💰 Investimento: ${dinheiro(a.gasto)}`);
  linhas.push(`👁️ Impressões: ${inteiro(a.impressoes)}`);
  if (p.alcance) linhas.push(`📈 Alcance: ${inteiro(p.alcance)}`);
  const tipos = [...a.porTipo.entries()].filter(([, t]) => t.qtd > 0).sort((x, y) => y[1].qtd - x[1].qtd);
  for (const [tipo, t] of tipos) {
    linhas.push(`${TIPOS[tipo].emoji} ${TIPOS[tipo].nome}: ${inteiro(t.qtd)}`);
    linhas.push(`${TIPOS[tipo].custo}: ${dinheiro(custo(t))}`);
  }
  linhas.push(`👆 Cliques no link: ${inteiro(a.cliques)}`);
  linhas.push(`📊 CTR (link): ${pct(a.ctr)}`);
  if (p.crm) {
    linhas.push("", `🗂️ Leads no CRM: ${inteiro(p.crm.leads)}`);
    if (p.crm.qualificados != null) linhas.push(`⭐ Qualificados: ${inteiro(p.crm.qualificados)}`);
    linhas.push(`🤝 Vendas: ${inteiro(p.crm.vendas)}${p.crm.faturamento ? ` (${dinheiro(p.crm.faturamento)})` : ""}`);
  }

  // ---- feedback ----
  linhas.push("", p.tipo === "semanal" ? "Feedback da semana" : "Feedback parcial");
  const fb: string[] = [];
  const [principal, ...outros] = tipos;
  if (principal) {
    const [tipo, t] = principal;
    const atualC = custo(t), antC = custo(b.porTipo.get(tipo));
    let comp = "";
    if (atualC != null && antC != null) {
      const chave = atualC < antC * 0.97 ? "melhor" : atualC > antC * 1.03 ? "pior" : "igual";
      comp = `, ${comparacao[chave]} (${dinheiro(antC)})`;
    }
    const abertura = p.tipo === "semanal" ? "A semana fechou com" : "Até agora a semana tem";
    fb.push(`${abertura} ${inteiro(t.qtd)} ${TIPOS[tipo].frase} com ${TIPOS[tipo].custo.replace(/^\S+\s/, "").toLowerCase()} de ${dinheiro(atualC)}${comp}.`);
    if (outros.length) {
      fb.push(`Também ${p.tipo === "semanal" ? "na semana" : "no período"}: ${outros.map(([tp, x]) => `${inteiro(x.qtd)} ${TIPOS[tp].curto}, a ${dinheiro(custo(x))} cada`).join("; ")}.`);
    }
  } else {
    fb.push("O período ainda não gerou resultados; vamos acompanhar de perto.");
  }
  if (a.revisar.length) fb.push(`${a.revisar.length === 1 ? "Um anúncio está" : `${a.revisar.length} anúncios estão`} abaixo do esperado e ${a.revisar.length === 1 ? "precisa" : "precisam"} de revisão.`);
  linhas.push(fb.join(" "));
  if (a.destaque && a.destaque.tipo) {
    linhas.push(`O destaque foi “${a.destaque.nome}”, com ${inteiro(a.destaque.qtd)} ${TIPOS[a.destaque.tipo].curto}.${p.link ? ` Criativo: ${p.link}` : ""}`);
  }

  // ---- próximos passos (regras simples, editáveis antes de enviar) ----
  const passos: string[] = [];
  const cprA = a.cprGeral, cprB = b.cprGeral;
  if (a.revisar.length) passos.push("🟡 Vamos ajustar os anúncios que perderam eficiência para melhorar o custo dos próximos resultados.");
  if (cprA != null && cprB != null && cprA < cprB * 0.9) passos.push("🟢 Os resultados melhoraram; vamos reforçar o investimento nos anúncios com melhor desempenho.");
  if (cprA != null && cprB != null && cprA > cprB * 1.15 && !a.revisar.length) passos.push("🟡 O custo subiu; vamos testar novos criativos e públicos para recuperar a eficiência.");
  if (!principal) passos.push("🟡 Vamos revisar a configuração das campanhas para destravar os resultados.");
  if (!passos.length) passos.push("🟢 Vamos manter a estratégia e seguir testando novos criativos para buscar resultados ainda melhores.");
  linhas.push("", "Próximos passos", ...passos);
  return linhas.join("\n");
}

/** Mensagens prontas para os clientes ativos (opcionalmente só de uma empresa). */
export async function gerarRelatorios(tipo: TipoRelatorio, empresa: string | null) {
  const banco = db();
  const { atual, anterior } = periodoRelatorio(tipo);
  const { data: clientesRaw } = await banco.from("clientes").select("*").eq("ativo", true).order("nome");
  const clientes = ((clientesRaw ?? []) as Cliente[]).filter((c) => !empresa || (c.empresa || EMPRESA_PADRAO) === empresa);
  const { data: contasRaw } = await banco.from("contas_anuncio").select("*").in("cliente_id", clientes.map((c) => c.id));
  const contas = (contasRaw ?? []) as ContaAnuncio[];
  const linhas = contas.length
    ? await buscarTudo<Linha>((de, ate) =>
        banco.from("metricas_diarias")
          .select("conta_id, data, ad_id, ad_nome, gasto, impressoes, cliques_link, resultados, resultado_tipo, leads, conversas, valor_compras")
          .in("conta_id", contas.map((c) => c.id)).gte("data", anterior.desde).lte("data", atual.ate).range(de, ate),
      )
    : [];
  const crm = await resumoCrm(
    { chave: "r", rotulo: "", qs: "", ...atual },
    { chave: "r", rotulo: "", qs: "", ...anterior },
  ).catch(() => new Map());

  return Promise.all(clientes.map(async (c) => {
    const minhas = contas.filter((x) => x.cliente_id === c.id);
    const ids = new Set(minhas.map((x) => x.id));
    const dentro = (l: Linha, p: { desde: string; ate: string }) => ids.has(l.conta_id) && l.data >= p.desde && l.data <= p.ate;
    const ra = resumir(linhas.filter((l) => dentro(l, atual)));
    const rb = resumir(linhas.filter((l) => dentro(l, anterior)));

    // dados ao vivo do Meta: alcance real e link do criativo destaque (se falhar, a mensagem sai sem eles)
    let alcance: number | null = 0;
    let link: string | null = null;
    try {
      for (const conta of minhas) {
        const token = await tokenDaConta(conta);
        if (!token) { alcance = null; break; }
        alcance += await alcanceDaConta(conta.id, token, atual.desde, atual.ate);
      }
      const contaDestaque = ra.destaque && minhas.find((x) => linhas.some((l) => l.conta_id === x.id && l.ad_id === ra.destaque!.id));
      const tokenDestaque = contaDestaque ? await tokenDaConta(contaDestaque) : undefined;
      if (ra.destaque && tokenDestaque) link = await linkDoCriativo(ra.destaque.id, tokenDestaque);
    } catch {
      alcance = null;
    }

    const numerosCrm = crm.get(c.id)?.atual ?? null;
    return {
      cliente: c,
      periodo: atual,
      texto: montarTexto({ tipo, periodo: atual, atual: ra, anterior: rb, alcance, link, crm: numerosCrm }),
    };
  }));
}
