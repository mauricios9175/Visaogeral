import "server-only";
import { db, EMPRESA_PADRAO, type Cliente } from "./db";
import { buscarTudo } from "./consultas";
import type { Periodo } from "./datas";
import { somarDias } from "./datas";

type Linha = {
  conta_id: string; data: string; ad_id: string; ad_nome: string | null; adset_nome: string | null; campaign_nome: string | null;
  gasto: number; impressoes: number; alcance: number; cliques_link: number;
  resultados: number; resultado_tipo: string | null; leads: number; conversas: number;
  video_plays?: number; video_3s?: number; video_p25?: number; video_p50?: number; video_p75?: number; video_p100?: number; video_thruplay?: number;
};

const CONVERSAO = new Set(["conversas", "formulario", "lead_site", "conv_personalizada", "compras", "cadastro"]);
const ROTULO: Record<string, string> = {
  conversas: "conversas", formulario: "leads (formulário)", lead_site: "leads no site",
  conv_personalizada: "conversões no site", compras: "compras", cadastro: "cadastros",
};

/** Resultados de conversão da linha (linhas antigas sem tipo: conversas + leads). */
const resultadoDe = (l: Linha) =>
  l.resultado_tipo ? (CONVERSAO.has(l.resultado_tipo) ? Number(l.resultados) : 0) : Number(l.conversas) + Number(l.leads);

export type Selo = "saturando" | "vencedor" | "sem_resultado";

export type Criativo = {
  id: string;
  nome: string;
  cliente: Pick<Cliente, "id" | "nome"> & { empresa: string };
  campanha: string | null;
  conjunto: string | null;
  status: string | null;
  formato: "video" | "imagem" | "outro";
  miniatura: string | null;
  link: string | null;
  texto: string | null;
  gasto: number;
  impressoes: number;
  cliques: number;
  resultados: number;
  tipoResultado: string | null;
  cpr: number | null;
  ctr: number | null;
  frequencia: number | null;
  video: { plays: number; gancho: number | null; retencao: number | null; quartis: number[] } | null;
  selos: Selo[];
  ctrRecente: number | null;
  ctrAntes: number | null;
};

const div = (a: number, b: number) => (b > 0 ? a / b : null);

/** Um item por anúncio que veiculou no período, com métricas, vídeo e selos (saturando / vencedor / sem resultado). */
export async function listarCriativos(periodo: Periodo, filtro: { clienteId?: string; empresa?: string }) {
  const banco = db();
  let qc = banco.from("clientes").select("id, nome, empresa").eq("ativo", true);
  if (filtro.clienteId) qc = qc.eq("id", filtro.clienteId);
  const { data: clientesRaw } = await qc;
  const clientes = ((clientesRaw ?? []) as Pick<Cliente, "id" | "nome" | "empresa">[])
    .filter((c) => !filtro.empresa || (c.empresa || EMPRESA_PADRAO) === filtro.empresa);
  const { data: contasRaw } = await banco.from("contas_anuncio").select("id, cliente_id").in("cliente_id", clientes.map((c) => c.id));
  const contas = (contasRaw ?? []) as { id: string; cliente_id: string }[];
  if (!contas.length) return [];
  const ids = contas.map((c) => c.id);

  const linhas = await buscarTudo<Linha>((de, ate) =>
    banco.from("metricas_diarias").select("*").in("conta_id", ids)
      .gte("data", periodo.desde).lte("data", periodo.ate).gt("impressoes", 0).range(de, ate),
  );
  const adIds = [...new Set(linhas.map((l) => l.ad_id))];

  // criativo e status: informativos; se as tabelas não existirem, segue sem eles
  const porLote = async <T,>(tabela: string, campos: string, coluna: string) => {
    const out: T[] = [];
    for (let i = 0; i < adIds.length; i += 300) {
      const { data, error } = await banco.from(tabela).select(campos).in(coluna, adIds.slice(i, i + 300));
      if (error) return out;
      out.push(...((data ?? []) as T[]));
    }
    return out;
  };
  type Cri = { ad_id: string; tipo: string | null; thumbnail_url: string | null; imagem_url: string | null; video_id: string | null; texto: string | null; link: string | null };
  const [cris, status] = await Promise.all([
    porLote<Cri>("criativos_meta", "ad_id, tipo, thumbnail_url, imagem_url, video_id, texto, link", "ad_id"),
    porLote<{ id: string; status: string }>("status_meta", "id, status", "id"),
  ]);
  const criPorAd = new Map(cris.map((c) => [c.ad_id, c]));
  const statusPorAd = new Map(status.map((s) => [s.id, s.status]));
  const clientePorConta = new Map(contas.map((c) => [c.id, c.cliente_id]));
  const clientePorId = new Map(clientes.map((c) => [c.id, c]));
  const ini3 = somarDias(periodo.ate, -2);

  const porAd = new Map<string, Linha[]>();
  for (const l of linhas) porAd.set(l.ad_id, [...(porAd.get(l.ad_id) ?? []), l]);

  const itens: Criativo[] = [];
  for (const [adId, ls] of porAd) {
    const cli = clientePorId.get(clientePorConta.get(ls[0].conta_id) ?? "");
    if (!cli) continue;
    const soma = (f: (l: Linha) => number, lista = ls) => lista.reduce((s, l) => s + Number(f(l) ?? 0), 0);
    const gasto = soma((l) => l.gasto), impressoes = soma((l) => l.impressoes), cliques = soma((l) => l.cliques_link);
    const alcance = soma((l) => l.alcance), resultados = soma(resultadoDe);
    const tipos = new Map<string, number>();
    for (const l of ls) if (l.resultado_tipo && CONVERSAO.has(l.resultado_tipo)) tipos.set(l.resultado_tipo, (tipos.get(l.resultado_tipo) ?? 0) + Number(l.resultados));
    const tipo = [...tipos.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

    const plays = soma((l) => l.video_plays ?? 0), s3 = soma((l) => l.video_3s ?? 0);
    const cri = criPorAd.get(adId);
    const ehVideo = cri?.tipo === "VIDEO" || !!cri?.video_id || s3 > 0;
    const recentes = ls.filter((l) => l.data >= ini3), antes = ls.filter((l) => l.data < ini3);
    const ctrRecente = div(soma((l) => l.cliques_link, recentes) * 100, soma((l) => l.impressoes, recentes));
    const ctrAntes = div(soma((l) => l.cliques_link, antes) * 100, soma((l) => l.impressoes, antes));
    const ultima = ls.reduce((a, b) => (b.data > a.data ? b : a));

    itens.push({
      id: adId,
      nome: ultima.ad_nome ?? "Anúncio",
      cliente: { id: cli.id, nome: cli.nome, empresa: cli.empresa || EMPRESA_PADRAO },
      campanha: ultima.campaign_nome,
      conjunto: ultima.adset_nome,
      status: statusPorAd.get(adId) ?? null,
      formato: ehVideo ? "video" : cri?.tipo === "PHOTO" || cri?.imagem_url ? "imagem" : "outro",
      // imagem em tamanho cheio quando houver; vídeo usa a miniatura
      miniatura: (!ehVideo && cri?.imagem_url) || cri?.thumbnail_url || cri?.imagem_url || null,
      link: cri?.link ?? null,
      texto: cri?.texto ?? null,
      gasto, impressoes, cliques, resultados,
      tipoResultado: tipo ? ROTULO[tipo] : null,
      cpr: div(gasto, resultados),
      ctr: div(cliques * 100, impressoes),
      // soma de alcance por dia superestima o alcance único: frequência aproximada (para mais)
      frequencia: div(impressoes, alcance),
      video: ehVideo && (plays > 0 || s3 > 0)
        ? {
            plays,
            gancho: div(s3 * 100, impressoes),
            retencao: div(soma((l) => l.video_thruplay ?? 0) * 100, s3),
            quartis: [soma((l) => l.video_p25 ?? 0), soma((l) => l.video_p50 ?? 0), soma((l) => l.video_p75 ?? 0), soma((l) => l.video_p100 ?? 0)]
              .map((q) => Math.min(100, div(q * 100, plays) ?? 0)),
          }
        : null,
      selos: [],
      ctrRecente, ctrAntes,
    });
  }

  // selos, comparando cada anúncio com a média do próprio cliente no período
  const mediaPorCliente = new Map<string, number | null>();
  for (const c of clientes) {
    const meus = itens.filter((i) => i.cliente.id === c.id);
    mediaPorCliente.set(c.id, div(meus.reduce((s, i) => s + i.gasto, 0), meus.reduce((s, i) => s + i.resultados, 0)));
  }
  for (const i of itens) {
    const media = mediaPorCliente.get(i.cliente.id) ?? null;
    if (i.ctrRecente != null && i.ctrAntes != null && i.ctrRecente < i.ctrAntes * 0.7 && (i.frequencia ?? 0) >= 2 && i.impressoes >= 1000) {
      i.selos.push("saturando");
    }
    if (i.cpr != null && media != null && i.resultados >= 3 && i.cpr <= media * 0.6) i.selos.push("vencedor");
    if (i.resultados === 0 && i.gasto >= Math.max(30, (media ?? 15) * 2)) i.selos.push("sem_resultado");
  }
  return itens;
}
