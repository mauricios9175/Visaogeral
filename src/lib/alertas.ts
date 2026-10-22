import "server-only";
import { db, EMPRESA_PADRAO, type Cliente, type ContaAnuncio } from "./db";
import { alertasContas, buscarTudo } from "./consultas";
import { diasAtras, somarDias } from "./datas";
import { dinheiro, inteiro } from "./formato";
import { somarGoogle, type LinhaGoogle } from "./consultas-google";

export type Nivel = "critico" | "atencao" | "oportunidade";

export type Alerta = {
  clienteId: string;
  clienteNome: string;
  empresa: string;
  nivel: Nivel;
  titulo: string;
  detalhe: string;
  sugestao: string;
  /** Ação rápida que resolve o alerta (pausar ou mexer no orçamento) */
  acao?: {
    plataforma: "meta" | "google"; contaId: string; objetoId: string; nivel: "campanha" | "conjunto" | "anuncio";
    nome: string; tipo: "pausar" | "orcamento";
  };
};

type Linha = {
  conta_id: string; data: string; ad_id: string; ad_nome: string | null; campaign_nome: string | null;
  adset_id: string | null; adset_nome: string | null;
  gasto: number; impressoes: number; alcance: number; cliques_link: number;
  resultados: number; resultado_tipo: string | null; leads: number; conversas: number;
};

const CONVERSAO = new Set(["conversas", "formulario", "lead_site", "conv_personalizada", "compras", "cadastro"]);

/** Resultados de conversão da linha (linhas antigas sem tipo: conversas + leads). */
const resultadoDe = (l: Linha) =>
  l.resultado_tipo ? (CONVERSAO.has(l.resultado_tipo) ? Number(l.resultados) : 0) : Number(l.conversas) + Number(l.leads);

type Soma = { gasto: number; res: number; impr: number; alc: number; cliques: number };
function somar(ls: Linha[]): Soma {
  return ls.reduce(
    (s, l) => ({
      gasto: s.gasto + Number(l.gasto), res: s.res + resultadoDe(l), impr: s.impr + Number(l.impressoes),
      alc: s.alc + Number(l.alcance), cliques: s.cliques + Number(l.cliques_link),
    }),
    { gasto: 0, res: 0, impr: 0, alc: 0, cliques: 0 },
  );
}
const cpr = (s: Soma) => (s.res ? s.gasto / s.res : null);
const ctr = (s: Soma) => (s.impr ? (s.cliques / s.impr) * 100 : null);

/**
 * Alertas de desempenho calculados com os dados já sincronizados (sem chamar o Meta):
 * janela recente = últimos 7 dias fechados (até ontem), comparada com os 7 dias antes.
 */
export async function calcularAlertas(): Promise<Alerta[]> {
  const banco = db();
  const ontem = diasAtras(1);
  const ini7 = somarDias(ontem, -6);
  const ini14 = somarDias(ontem, -13);
  const ini3 = somarDias(ontem, -2);

  const { data: clientesRaw } = await banco.from("clientes").select("*").eq("ativo", true);
  const clientes = (clientesRaw ?? []) as Cliente[];
  const { data: contasRaw } = await banco.from("contas_anuncio").select("id, cliente_id").in("cliente_id", clientes.map((c) => c.id));
  const contas = (contasRaw ?? []) as Pick<ContaAnuncio, "id" | "cliente_id">[];
  const linhas = contas.length
    ? await buscarTudo<Linha>((de, ate) =>
        banco.from("metricas_diarias")
          .select("conta_id, data, ad_id, ad_nome, adset_id, adset_nome, campaign_nome, gasto, impressoes, alcance, cliques_link, resultados, resultado_tipo, leads, conversas")
          .in("conta_id", contas.map((c) => c.id)).gte("data", ini14).lte("data", ontem).range(de, ate),
      )
    : [];

  // Google Ads (se o SQL do Google não rodou, segue sem ele)
  const { data: contasGRaw } = await banco.from("contas_google").select("id, cliente_id").in("cliente_id", clientes.map((c) => c.id));
  const contasG = (contasGRaw ?? []) as { id: string; cliente_id: string }[];
  const linhasG = contasG.length
    ? await buscarTudo<LinhaGoogle>((de, ate) =>
        banco.from("metricas_google").select("*")
          .in("conta_id", contasG.map((c) => c.id)).gte("data", ini14).lte("data", ontem).range(de, ate),
      ).catch(() => [])
    : [];

  const alertas: Alerta[] = [];
  for (const c of clientes) {
    const base = { clienteId: c.id, clienteNome: c.nome, empresa: c.empresa || EMPRESA_PADRAO };
    const idsG = new Set(contasG.filter((x) => x.cliente_id === c.id).map((x) => x.id));
    if (idsG.size) alertas.push(...alertasGoogle(base, linhasG.filter((l) => idsG.has(l.conta_id)), { ontem, ini7, ini3 }));
  }

  for (const c of clientes) {
    const base = { clienteId: c.id, clienteNome: c.nome, empresa: c.empresa || EMPRESA_PADRAO };
    const ids = new Set(contas.filter((x) => x.cliente_id === c.id).map((x) => x.id));
    const minhas = linhas.filter((l) => ids.has(l.conta_id));
    if (!minhas.length) continue;
    const rec = minhas.filter((l) => l.data >= ini7);
    const ant = minhas.filter((l) => l.data < ini7);
    const sRec = somar(rec), sAnt = somar(ant);
    const cprRec = cpr(sRec), cprAnt = cpr(sAnt);

    // 1. Anúncios pararam: gastava na semana anterior e não gastou ontem
    const gastoOntem = somar(minhas.filter((l) => l.data === ontem)).gasto;
    if (sAnt.gasto > 50 && gastoOntem === 0 && sRec.gasto > 0) {
      alertas.push({ ...base, nivel: "critico", titulo: "Anúncios sem veicular ontem",
        detalhe: `Nenhum gasto ontem; nos 7 dias anteriores a média era ${dinheiro(sAnt.gasto / 7)}/dia.`,
        sugestao: "Confira saldo, pagamento, reprovações e se as campanhas foram pausadas." });
    }

    // 2. Custo por resultado subiu
    if (cprRec != null && cprAnt != null && sRec.res >= 3 && cprRec > cprAnt * 1.3) {
      const alta = (cprRec / cprAnt - 1) * 100;
      alertas.push({ ...base, nivel: alta >= 50 ? "critico" : "atencao",
        titulo: `Custo por resultado subiu ${alta.toFixed(0)}%`,
        detalhe: `${dinheiro(cprRec)} nos últimos 7 dias contra ${dinheiro(cprAnt)} na semana anterior.`,
        sugestao: "Veja quais anúncios puxaram o custo para cima e revise criativos e públicos." });
    }

    // 3. Acima da meta
    if (c.cpl_meta && cprRec != null && cprRec > c.cpl_meta * 1.3) {
      alertas.push({ ...base, nivel: "critico", titulo: "Custo por resultado acima da meta",
        detalhe: `${dinheiro(cprRec)} nos últimos 7 dias; a meta é ${dinheiro(c.cpl_meta)}.`,
        sugestao: "Concentre a verba nos anúncios abaixo da meta e pause os mais caros." });
    }

    // 4. Resultados caíram com gasto parecido
    if (sAnt.res >= 6 && sRec.res <= sAnt.res * 0.5 && sRec.gasto >= sAnt.gasto * 0.7) {
      alertas.push({ ...base, nivel: "atencao", titulo: "Resultados caíram pela metade",
        detalhe: `${inteiro(sRec.res)} resultados nos últimos 7 dias contra ${inteiro(sAnt.res)} na semana anterior, com investimento parecido.`,
        sugestao: "Cheque se houve mudança no formulário, no WhatsApp ou na página, e renove os criativos." });
    }

    // ---- por anúncio ----
    const porAnuncio = new Map<string, Linha[]>();
    for (const l of rec) porAnuncio.set(l.ad_id, [...(porAnuncio.get(l.ad_id) ?? []), l]);
    const media = cprRec;
    for (const ls of porAnuncio.values()) {
      const nome = ls[0].ad_nome ?? "Anúncio";
      const s7 = somar(ls);
      const s3 = somar(ls.filter((l) => l.data >= ini3));
      const sAntes = somar(ls.filter((l) => l.data < ini3));

      // 5. Gastou sem resultado nos últimos 3 dias
      const limite = Math.max(30, (media ?? 30) * 2);
      if (s3.gasto >= limite && s3.res === 0) {
        alertas.push({ ...base, nivel: s3.gasto >= limite * 2 ? "critico" : "atencao",
          titulo: "Anúncio gastando sem resultado",
          detalhe: `“${nome}” gastou ${dinheiro(s3.gasto)} nos últimos 3 dias sem nenhum resultado.`,
          sugestao: "Pause ou troque o criativo/público desse anúncio.",
          acao: { plataforma: "meta", contaId: ls[0].conta_id, objetoId: ls[0].ad_id, nivel: "anuncio", nome, tipo: "pausar" } });
      }

      // 6. Criativo saturando: CTR caiu e frequência alta
      const ctr3 = ctr(s3), ctrAntes = ctr(sAntes);
      const freq = s7.alc ? s7.impr / s7.alc : 0;
      if (ctr3 != null && ctrAntes != null && s3.impr >= 1000 && ctr3 < ctrAntes * 0.7 && freq >= 2) {
        alertas.push({ ...base, nivel: "atencao", titulo: "Criativo saturando",
          detalhe: `“${nome}”: CTR caiu de ${ctrAntes.toFixed(2).replace(".", ",")}% para ${ctr3.toFixed(2).replace(".", ",")}% nos últimos 3 dias (frequência ~${freq.toFixed(1).replace(".", ",")}).`,
          sugestao: "Prepare um criativo novo para substituir esse.",
          acao: { plataforma: "meta", contaId: ls[0].conta_id, objetoId: ls[0].ad_id, nivel: "anuncio", nome, tipo: "pausar" } });
      }

      // 7. Vencedor: custo bem abaixo da média do cliente
      const cprAd = cpr(s7);
      if (cprAd != null && media != null && s7.res >= 3 && cprAd <= media * 0.6) {
        alertas.push({ ...base, nivel: "oportunidade", titulo: "Anúncio com ótimo desempenho",
          detalhe: `“${nome}”: ${inteiro(s7.res)} resultados a ${dinheiro(cprAd)} cada (média do cliente: ${dinheiro(media)}).`,
          sugestao: "Considere aumentar o orçamento desse conjunto ou duplicar o anúncio.",
          ...(ls[0].adset_id && {
            acao: { plataforma: "meta" as const, contaId: ls[0].conta_id, objetoId: ls[0].adset_id, nivel: "conjunto" as const, nome: ls[0].adset_nome ?? "Conjunto", tipo: "orcamento" as const },
          }) });
      }
    }
  }

  // Saldo, limite de gastos e status das contas do Meta
  const contasAlertas = await alertasContas().catch(() => []);
  const empresaPorCliente = new Map(clientes.map((c) => [c.id, c.empresa || EMPRESA_PADRAO]));
  for (const a of contasAlertas) {
    alertas.push({
      clienteId: a.clienteId, clienteNome: a.clienteNome, empresa: empresaPorCliente.get(a.clienteId) ?? EMPRESA_PADRAO,
      nivel: a.nivel, titulo: `Conta ${a.contaNome}`, detalhe: a.mensagem, sugestao: "Resolva na conta de anúncios ou avise o cliente.",
    });
  }

  const ordem: Record<Nivel, number> = { critico: 0, atencao: 1, oportunidade: 2 };
  return alertas.sort((a, b) => ordem[a.nivel] - ordem[b.nivel] || a.clienteNome.localeCompare(b.clienteNome));
}

/** Mesmas ideias do Meta, por campanha do Google: parou, custo subiu, gastando sem converter, campanha vencedora. */
function alertasGoogle(
  base: Pick<Alerta, "clienteId" | "clienteNome" | "empresa">,
  linhas: LinhaGoogle[],
  { ontem, ini7, ini3 }: { ontem: string; ini7: string; ini3: string },
): Alerta[] {
  const alertas: Alerta[] = [];
  if (!linhas.length) return alertas;
  const conv = (v: number) => inteiro(Math.round(v));
  const rec = somarGoogle(linhas.filter((l) => l.data >= ini7));
  const ant = somarGoogle(linhas.filter((l) => l.data < ini7));

  const gastoOntem = somarGoogle(linhas.filter((l) => l.data === ontem)).gasto;
  if (ant.gasto > 50 && gastoOntem === 0 && rec.gasto > 0) {
    alertas.push({ ...base, nivel: "critico", titulo: "Google · campanhas sem veicular ontem",
      detalhe: `Nenhum gasto no Google ontem; nos 7 dias anteriores a média era ${dinheiro(ant.gasto / 7)}/dia.`,
      sugestao: "Confira pagamento da conta, reprovações e se as campanhas foram pausadas." });
  }

  if (rec.cpa != null && ant.cpa != null && rec.conversoes >= 3 && rec.cpa > ant.cpa * 1.3) {
    const alta = (rec.cpa / ant.cpa - 1) * 100;
    alertas.push({ ...base, nivel: alta >= 50 ? "critico" : "atencao",
      titulo: `Google · custo por conversão subiu ${alta.toFixed(0)}%`,
      detalhe: `${dinheiro(rec.cpa)} nos últimos 7 dias contra ${dinheiro(ant.cpa)} na semana anterior.`,
      sugestao: "Revise termos de pesquisa, palavras-chave negativas e lances das campanhas que encareceram." });
  }

  const porCampanha = new Map<string, LinhaGoogle[]>();
  for (const l of linhas) if (l.data >= ini7) porCampanha.set(l.campaign_id, [...(porCampanha.get(l.campaign_id) ?? []), l]);
  for (const ls of porCampanha.values()) {
    const nome = ls[0].campaign_nome ?? "Campanha";
    const s7 = somarGoogle(ls);
    const s3 = somarGoogle(ls.filter((l) => l.data >= ini3));
    const limite = Math.max(30, (rec.cpa ?? 30) * 2);
    if (s3.gasto >= limite && s3.conversoes === 0) {
      alertas.push({ ...base, nivel: s3.gasto >= limite * 2 ? "critico" : "atencao",
        titulo: "Google · campanha gastando sem conversão",
        detalhe: `“${nome}” gastou ${dinheiro(s3.gasto)} nos últimos 3 dias sem nenhuma conversão.`,
        sugestao: "Veja os termos de pesquisa, o rastreamento de conversões e a página de destino dessa campanha.",
        acao: { plataforma: "google", contaId: ls[0].conta_id, objetoId: ls[0].campaign_id, nivel: "campanha", nome, tipo: "pausar" } });
    }
    if (s7.cpa != null && rec.cpa != null && s7.conversoes >= 3 && s7.cpa <= rec.cpa * 0.6 && porCampanha.size > 1) {
      alertas.push({ ...base, nivel: "oportunidade", titulo: "Google · campanha com ótimo desempenho",
        detalhe: `“${nome}”: ${conv(s7.conversoes)} conversões a ${dinheiro(s7.cpa)} cada (média do cliente no Google: ${dinheiro(rec.cpa)}).`,
        sugestao: "Considere aumentar o orçamento dessa campanha.",
        acao: { plataforma: "google", contaId: ls[0].conta_id, objetoId: ls[0].campaign_id, nivel: "campanha", nome, tipo: "orcamento" } });
    }
  }
  return alertas;
}
