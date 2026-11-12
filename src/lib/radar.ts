import "server-only";
import { db } from "./db";
import { listarCriativos, type Criativo } from "./criativos";
import { hojeISO, resolverPeriodo } from "./datas";
import { pct } from "./formato";
import { apagarArquivoIA, enviarArquivoIA, geminiParaVideo, perguntarIA, type ParteIA } from "./ia";
import { lerAnaliseCriativo, pesquisaDoNicho, type PesquisaNicho } from "./analise-criativo";
import { chaveDe } from "./agrupar";
import { apagar, baixar } from "./armazenamento";
import { briefingDoCliente } from "./ficha";

// Radar de criativos (gratuito): todo dia, por nicho dos clientes,
//  1) os melhores criativos dos SEUS clientes no nicho (números reais: custo, CTR, gancho) com a análise da IA;
//  2) buscas prontas na Biblioteca de Anúncios da Meta (anúncios ativos no Brasil com as palavras do nicho);
//  3) a pesquisa na internet do que está em alta no nicho.
// E o "Analisar este anúncio": você manda o vídeo/print de um anúncio que achou e a IA diz por que funciona e como adaptar.
// A API da Biblioteca não traz anúncios comerciais do Brasil, por isso as buscas são links (abrem na Biblioteca).

export type CriativoRadar = {
  id: string; nome: string; cliente: { id: string; nome: string }; formato: string; miniatura: string | null; link: string | null;
  gasto: number; resultados: number; tipoResultado: string | null; cpr: number | null; ctr: number | null; gancho: number | null;
  vsMedia: number | null;      // custo por resultado ÷ média do próprio cliente (0,6 = 40% mais barato)
  nota: number | null; porque: string | null;
};

export type NichoRadar = {
  nicho: string;
  clientes: { id: string; nome: string }[];
  palavras: string[];
  buscas: { palavra: string; url: string; video: string }[];
  melhores: CriativoRadar[];
  pesquisa: PesquisaNicho | null;
};

export type Radar = { data: string; criadoEm: string; nichos: NichoRadar[]; pendentes?: string[] }; // pendentes: nichos que faltam montar hoje

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Link da Biblioteca de Anúncios: anúncios ativos no Brasil com a palavra (todas as mídias ou só vídeo). */
export function linkBiblioteca(palavra: string, midia: "all" | "video" = "all") {
  const q = new URLSearchParams({
    active_status: "active", ad_type: "all", country: "BR", is_targeted_country: "false", media_type: midia, q: palavra, search_type: "keyword_unordered",
  });
  return `https://www.facebook.com/ads/library/?${q}`;
}

export async function lerRadar(): Promise<Radar | null> {
  const { data } = await db().from("configuracoes").select("valor").eq("chave", "radar_atual").maybeSingle();
  return (data?.valor as Radar | undefined) ?? null;
}

/** Palavras de busca do nicho (a IA sugere uma vez; dá para trocar na tela). */
export async function palavrasDoNicho(nicho: string, forcar = false): Promise<string[]> {
  const chave = `radar_palavras:${chaveDe(nicho)}`;
  const { data } = await db().from("configuracoes").select("valor").eq("chave", chave).maybeSingle();
  if (!forcar && Array.isArray(data?.valor) && data.valor.length) return data.valor as string[];
  let palavras = [nicho];
  try {
    const r = await perguntarIA(
      "Você ajuda um gestor de tráfego a achar anúncios de concorrentes na Biblioteca de Anúncios da Meta (Brasil). Responda só JSON.",
      `Nicho: "${nicho}". Dê 6 termos de busca curtos (1 a 3 palavras, português do Brasil) que os anunciantes desse nicho escrevem nos anúncios,
do mais genérico ao mais específico (produto/serviço, dor, oferta). Ex. para "esquadrias de alumínio": ["esquadrias de alumínio", "janela de alumínio", "porta de vidro", "orçamento esquadrias", "fachada de vidro", "box de banheiro"].
Formato: { "termos": ["…"] }`,
      { json: true, temperatura: 0.3 },
    );
    const j = JSON.parse(r.replace(/^```(?:json)?\s*|\s*```$/g, "")) as { termos?: unknown };
    const t = Array.isArray(j.termos) ? j.termos.map(String).map((x) => x.trim()).filter(Boolean).slice(0, 8) : [];
    if (t.length) palavras = t;
  } catch { /* sem IA: fica o próprio nicho */ }
  await db().from("configuracoes").upsert({ chave, valor: palavras, atualizado_em: new Date().toISOString() });
  return palavras;
}

export async function salvarPalavras(nicho: string, palavras: string[]) {
  const limpas = [...new Set(palavras.map((x) => x.trim()).filter(Boolean))].slice(0, 12).map((x) => x.slice(0, 60));
  await db().from("configuracoes").upsert({ chave: `radar_palavras:${chaveDe(nicho)}`, valor: limpas, atualizado_em: new Date().toISOString() });
  // atualiza o radar salvo, para a tela mostrar na hora
  const radar = await lerRadar();
  if (radar) {
    for (const n of radar.nichos) {
      if (chaveDe(n.nicho) !== chaveDe(nicho)) continue;
      n.palavras = limpas;
      n.buscas = limpas.map((p) => ({ palavra: p, url: linkBiblioteca(p), video: linkBiblioteca(p, "video") }));
    }
    await db().from("configuracoes").upsert({ chave: "radar_atual", valor: radar, atualizado_em: new Date().toISOString() });
  }
  return limpas;
}

/** Os melhores criativos dos clientes do nicho: custo por resultado bem abaixo da média do próprio cliente, com volume. */
async function melhoresDoNicho(clientes: Set<string>, todos: Criativo[]): Promise<CriativoRadar[]> {
  const doNicho = todos.filter((c) => clientes.has(c.cliente.id));
  const mediaCliente = new Map<string, number | null>();
  for (const id of clientes) {
    const cs = doNicho.filter((c) => c.cliente.id === id);
    const g = cs.reduce((t, c) => t + c.gasto, 0), r = cs.reduce((t, c) => t + c.resultados, 0);
    mediaCliente.set(id, r ? g / r : null);
  }
  const candidatos = doNicho
    .filter((c) => c.gasto >= 30 && c.resultados >= 3 && c.cpr != null)
    .map((c) => ({ c, vs: mediaCliente.get(c.cliente.id) ? c.cpr! / mediaCliente.get(c.cliente.id)! : null }))
    .sort((a, b) => (a.vs ?? 9) - (b.vs ?? 9) || b.c.resultados - a.c.resultados)
    .slice(0, 6);
  const analises = await Promise.all(candidatos.map((x) => lerAnaliseCriativo(x.c.id).catch(() => null)));
  return candidatos.map(({ c, vs }, i) => {
    const a = analises[i];
    const auto = [vs != null && vs < 1 ? `custo por resultado ${Math.round((1 - vs) * 100)}% abaixo da média do cliente` : null,
      c.video?.gancho != null ? `gancho ${pct(c.video.gancho)}` : null, c.ctr != null ? `CTR ${pct(c.ctr)}` : null].filter(Boolean).join(" · ");
    return {
      id: c.id, nome: c.nome, cliente: { id: c.cliente.id, nome: c.cliente.nome }, formato: c.formato, miniatura: c.miniatura, link: c.link,
      gasto: c.gasto, resultados: c.resultados, tipoResultado: c.tipoResultado, cpr: c.cpr, ctr: c.ctr, gancho: c.video?.gancho ?? null,
      vsMedia: vs, nota: a?.nota ?? null, porque: a ? `${a.resumo} Gancho: ${a.gancho.oQueAcontece}` : auto || null,
    };
  });
}

/**
 * Monta o radar do dia em partes (para caber no tempo do servidor): cada chamada faz os nichos que couberem e guarda;
 * a próxima continua de onde parou. `seNecessario`: se o de hoje já está completo, não faz nada (o agendador chama
 * várias vezes ao dia; a primeira depois da meia-noite monta).
 */
export async function gerarRadar(opcoes: { seNecessario?: boolean; recomecar?: boolean; orcamentoMs?: number } = {}): Promise<Radar & { feitoAgora: number }> {
  const inicio = Date.now();
  const orcamento = opcoes.orcamentoMs ?? 200_000;
  const hoje = hojeISO();
  const salvo = await lerRadar();
  const deHoje = salvo?.data === hoje && !opcoes.recomecar;
  if (opcoes.seNecessario && deHoje && !salvo!.pendentes?.length) return { ...salvo!, feitoAgora: 0 };

  const { data } = await db().from("clientes").select("id, nome, nicho").eq("ativo", true);
  const porNicho = new Map<string, { nicho: string; clientes: { id: string; nome: string }[] }>();
  for (const c of (data ?? []) as { id: string; nome: string; nicho: string | null }[]) {
    if (!c.nicho?.trim()) continue;
    const k = sem(c.nicho);
    const g = porNicho.get(k) ?? { nicho: c.nicho.trim(), clientes: [] };
    g.clientes.push({ id: c.id, nome: c.nome });
    porNicho.set(k, g);
  }
  const grupos = [...porNicho.values()].sort((a, b) => b.clientes.length - a.clientes.length || a.nicho.localeCompare(b.nicho, "pt-BR"));
  // continua o de hoje (os nichos já feitos ficam); senão começa do zero, mantendo o de ontem na tela até terminar
  const feitos = new Map((deHoje ? salvo!.nichos : []).map((n) => [sem(n.nicho), n]));
  const faltam = grupos.filter((g) => !feitos.has(sem(g.nicho)));
  const { atual } = resolverPeriodo({ p: "30" });
  const todos = faltam.length ? await listarCriativos(atual, {}) : [];
  let feitoAgora = 0;
  // 3 nichos por vez (pesquisa e termos usam a IA na primeira vez de cada nicho); para quando o tempo acabar
  for (let i = 0; i < faltam.length && Date.now() - inicio < orcamento; i += 3) {
    const lote = await Promise.all(faltam.slice(i, i + 3).map(async (g): Promise<NichoRadar> => {
      const [palavras, melhores, pesquisa] = await Promise.all([
        palavrasDoNicho(g.nicho).catch(() => [g.nicho]),
        melhoresDoNicho(new Set(g.clientes.map((c) => c.id)), todos).catch(() => []),
        pesquisaDoNicho(g.nicho).catch(() => null),
      ]);
      return {
        nicho: g.nicho, clientes: g.clientes, palavras, melhores, pesquisa,
        buscas: palavras.map((p) => ({ palavra: p, url: linkBiblioteca(p), video: linkBiblioteca(p, "video") })),
      };
    }));
    for (const n of lote) feitos.set(sem(n.nicho), n);
    feitoAgora += lote.length;
  }
  const nichos = grupos.map((g) => feitos.get(sem(g.nicho))).filter((n): n is NichoRadar => !!n);
  const pendentes = grupos.filter((g) => !feitos.has(sem(g.nicho))).map((g) => g.nicho);
  // enquanto o de hoje não tem nada, os nichos de ontem continuam aparecendo
  const radar: Radar = {
    data: hoje, criadoEm: new Date().toISOString(),
    nichos: nichos.length ? nichos : salvo?.nichos ?? [],
    ...(pendentes.length ? { pendentes } : {}),
  };
  const { error } = await db().from("configuracoes").upsert({ chave: "radar_atual", valor: radar, atualizado_em: radar.criadoEm });
  if (error) throw new Error(error.message);
  return { ...radar, feitoAgora };
}

// ---------- "Analisar este anúncio" (o que você achou na Biblioteca, no feed ou num concorrente) ----------

export type AnaliseExterna = {
  nota: number;
  resumo: string;
  porQueFunciona: string[];
  gancho: string;
  estrutura: string;
  oferta: string;
  sinais: string;           // o que o tempo no ar / versões dizem
  comoAdaptar: string[];    // para o cliente escolhido (ou para o nicho)
  roteiro: string;          // ideia de roteiro/peça adaptada
};

export type AnuncioSalvo = {
  id: string; criadoEm: string; link: string; nicho: string; clienteId: string | null; clienteNome: string | null;
  diasNoAr: number | null; versoes: number | null; observacao: string; formato: "video" | "imagem"; analise: AnaliseExterna;
};

const MAX_SALVOS = 150;

export async function listarSalvos(): Promise<AnuncioSalvo[]> {
  const { data } = await db().from("configuracoes").select("valor").eq("chave", "radar_salvos").maybeSingle();
  return Array.isArray(data?.valor) ? (data.valor as AnuncioSalvo[]) : [];
}

export async function excluirSalvo(id: string) {
  const lista = (await listarSalvos()).filter((x) => x.id !== id);
  await db().from("configuracoes").upsert({ chave: "radar_salvos", valor: lista, atualizado_em: new Date().toISOString() });
  return lista;
}

const SISTEMA_EXTERNO = `Você é um estrategista de criativos de anúncios (Meta Ads) para negócios locais no Brasil.
Vai receber um anúncio de OUTRA empresa (vídeo ou imagem), o texto que o gestor colou (se houver) e os sinais da Biblioteca de Anúncios
(há quanto tempo está no ar e quantas versões usam o mesmo criativo: anúncio no ar há muito tempo e com várias versões costuma estar dando resultado).
Explique por que ele funciona e como adaptar para o cliente do gestor (sem copiar: adaptar a ideia, o gancho e a estrutura).
Responda SÓ com JSON:
{
  "nota": 0 a 10 (o quanto vale se inspirar nele),
  "resumo": "2 frases: o que é o anúncio e por que chama atenção",
  "porQueFunciona": ["3 a 6 motivos concretos (gancho, prova, oferta, formato, ritmo, público)"],
  "gancho": "o que acontece nos primeiros segundos / o que chama atenção primeiro",
  "estrutura": "a sequência do anúncio em uma linha (ex.: gancho → problema → antes/depois → oferta → CTA)",
  "oferta": "a oferta e a chamada para ação",
  "sinais": "o que o tempo no ar e as versões indicam (ou 'sem sinais informados')",
  "comoAdaptar": ["3 a 5 ideias concretas para o cliente/nicho do gestor"],
  "roteiro": "uma ideia de roteiro (vídeo) ou peça (imagem) adaptada, em 4 a 6 linhas"
}
Português do Brasil, direto. Se não conseguir ver o vídeo, diga isso no resumo.`;

/** Analisa um anúncio de fora (arquivo enviado pelo navegador para o Storage) e guarda na lista de salvos. */
export async function analisarAnuncioExterno(p: {
  link: string; caminho: string | null; mime: string | null; nicho: string; clienteId: string | null;
  diasNoAr: number | null; versoes: number | null; observacao: string; texto: string;
}): Promise<AnuncioSalvo> {
  if (!p.caminho && !p.texto.trim()) throw new Error("Envie o vídeo ou o print do anúncio (ou cole o texto dele).");
  const video = !!p.mime?.startsWith("video/");
  const partes: ParteIA[] = [];
  let arquivoIA: string | null = null;
  try {
    if (p.caminho) {
      const blob = await baixar(p.caminho);
      if (video) {
        if (!(await geminiParaVideo())) throw new Error("Para assistir ao vídeo é preciso o Gemini ligado (Configurações → IA do painel). Mande um print no lugar.");
        const enviado = await enviarArquivoIA(await blob.arrayBuffer(), p.mime!, "anuncio-radar");
        arquivoIA = enviado.nome;
        partes.push({ arquivo: { mime: enviado.mime, uri: enviado.uri } });
      } else {
        partes.push({ imagem: { mime: p.mime || "image/jpeg", base64: Buffer.from(await blob.arrayBuffer()).toString("base64") } });
      }
    }
    type ClienteRadar = { id: string; nome: string; nicho: string | null };
    let cliente = null as ClienteRadar | null;
    let briefing = "";
    if (p.clienteId) {
      const { data } = await db().from("clientes").select("id, nome, nicho").eq("id", p.clienteId).maybeSingle();
      cliente = (data as ClienteRadar | null) ?? null;
      briefing = await briefingDoCliente(p.clienteId).catch(() => "");
    }
    partes.push({ texto: [
      `Nicho: ${p.nicho || "(não informado)"}`,
      cliente ? `Cliente do gestor para adaptar: ${cliente.nome}${cliente.nicho ? ` (${cliente.nicho})` : ""}` : "Adaptar para o nicho em geral.",
      briefing ? `Briefing do cliente:\n${briefing.slice(0, 1500)}` : "",
      `Sinais da Biblioteca: ${p.diasNoAr != null ? `no ar há ${p.diasNoAr} dias` : "tempo no ar não informado"}; ${p.versoes != null ? `${p.versoes} anúncio(s) usam esse criativo` : "versões não informadas"}.`,
      p.texto.trim() ? `Texto do anúncio (colado):\n${p.texto.trim().slice(0, 2000)}` : "",
      p.observacao.trim() ? `Observação do gestor: ${p.observacao.trim().slice(0, 500)}` : "",
      p.link ? `Link: ${p.link}` : "",
    ].filter(Boolean).join("\n\n") });
    const bruto = await perguntarIA(SISTEMA_EXTERNO, partes, { json: true, temperatura: 0.4, tempoMs: 150_000 });
    let r: Partial<AnaliseExterna>;
    try { r = JSON.parse(bruto.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { throw new Error("A IA respondeu num formato inesperado. Tente de novo."); }
    const lista = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 8) : []);
    const salvo: AnuncioSalvo = {
      id: crypto.randomUUID(), criadoEm: new Date().toISOString(), link: p.link, nicho: p.nicho, clienteId: cliente?.id ?? null, clienteNome: cliente?.nome ?? null,
      diasNoAr: p.diasNoAr, versoes: p.versoes, observacao: p.observacao, formato: video ? "video" : "imagem",
      analise: {
        nota: Math.max(0, Math.min(10, Math.round(Number(r.nota) || 0))), resumo: String(r.resumo ?? ""),
        porQueFunciona: lista(r.porQueFunciona), gancho: String(r.gancho ?? ""), estrutura: String(r.estrutura ?? ""), oferta: String(r.oferta ?? ""),
        sinais: String(r.sinais ?? ""), comoAdaptar: lista(r.comoAdaptar), roteiro: String(r.roteiro ?? ""),
      },
    };
    const lista2 = [salvo, ...(await listarSalvos())].slice(0, MAX_SALVOS);
    await db().from("configuracoes").upsert({ chave: "radar_salvos", valor: lista2, atualizado_em: salvo.criadoEm });
    return salvo;
  } finally {
    if (arquivoIA) await apagarArquivoIA(arquivoIA);
    if (p.caminho) await apagar([p.caminho]);
  }
}

