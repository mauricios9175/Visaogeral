import "server-only";
import { db, type ContaAnuncio } from "./db";
import { detalheCrm, type NumerosCrm } from "./consultas";
import { listarCriativos, type Criativo } from "./criativos";
import { resolverPeriodo } from "./datas";
import { decimal, dinheiro, inteiro, pct } from "./formato";
import { apagarArquivoIA, enviarArquivoIA, perguntarIA, type ParteIA } from "./ia";
import { fonteDoVideo } from "./meta-montar";
import { chaveDe, nomeDoAnuncio } from "./agrupar";
import { tokenDaConta } from "./sync";

// Análise de criativo com IA: a IA assiste ao vídeo (imagem e áudio) ou olha a imagem, lê o texto do anúncio e cruza
// com os números do próprio anúncio (gancho, retenção, CTR, custo) e com o CRM. A análise fica salva por anúncio.

export type AnaliseCriativo = {
  adId: string;
  nome: string;
  formato: "video" | "imagem" | "outro";
  criadoEm: string;
  periodo: string;
  nota: number;                       // 0 a 10
  resumo: string;
  gancho: { oQueAcontece: string; avaliacao: "forte" | "medio" | "fraco"; porque: string };
  estrutura: { parte: string; momento: string; conteudo: string }[];
  falas: string;                      // vídeo: o principal do que é falado
  pontosFortes: string[];
  pontosFracos: string[];
  sugestoes: string[];
  numeros: string;                    // como os números confirmam (ou não) a leitura
};

const chave = (adId: string) => `analise_criativo:${adId}`;
const LIMITE_VIDEO = 200 * 1024 * 1024; // acima disso, pede uma versão menor

export async function lerAnaliseCriativo(adId: string): Promise<AnaliseCriativo | null> {
  const { data } = await db().from("configuracoes").select("valor").eq("chave", chave(adId)).maybeSingle();
  return (data?.valor as AnaliseCriativo | null) ?? null;
}

const SISTEMA = `Você é um estrategista de criativos de anúncios (Meta Ads) no Brasil, especialista em vídeos curtos e peças de imagem para negócios locais.
Analise o criativo enviado (assista ao vídeo inteiro, com o áudio, ou olhe a imagem com atenção) junto com o texto do anúncio e os números dele.
Responda SÓ com um JSON neste formato:
{
  "nota": número de 0 a 10 (qualidade do criativo para gerar resultado),
  "resumo": "2 a 3 frases: o que é o criativo e o veredito",
  "gancho": {
    "oQueAcontece": "vídeo: o que aparece e o que é dito nos 3 primeiros segundos; imagem: o que chama atenção primeiro",
    "avaliacao": "forte" | "medio" | "fraco",
    "porque": "por que prende (ou não) a atenção"
  },
  "estrutura": [ { "parte": "Gancho | Problema | Solução | Prova | Oferta | Chamada para ação | Outro", "momento": "vídeo: 0-3s, 3-10s…; imagem: posição na peça", "conteudo": "o que acontece/é dito" } ],
  "falas": "vídeo: o principal do que é falado e da legenda (curto); imagem: o texto escrito na arte",
  "pontosFortes": ["…"],
  "pontosFracos": ["…"],
  "sugestoes": ["3 a 5 mudanças concretas para a próxima versão (ex.: novo gancho com a frase X; mostrar o produto antes dos 2 s)"],
  "numeros": "como os números do anúncio confirmam ou contradizem a sua leitura (cite gancho, retenção, CTR, custo e CRM quando houver, comparando com a média do cliente)"
}
Regras: português do Brasil, direto, sem enrolação. Baseie-se no que você realmente vê e ouve. Se o volume de dados for pequeno, diga isso em "numeros".`;

function linhaNumeros(c: Criativo, todos: Criativo[], crm: NumerosCrm | null) {
  const doCliente = todos.filter((x) => x.cliente.id === c.cliente.id);
  const media = (f: (x: Criativo) => number | null | undefined, lista = doCliente) => {
    const v = lista.map(f).filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const videos = doCliente.filter((x) => x.video);
  const gasto = doCliente.reduce((t, x) => t + x.gasto, 0), res = doCliente.reduce((t, x) => t + x.resultados, 0);
  const L = [
    `Anúncio: ${c.nome} (cliente ${c.cliente.nome}${c.campanha ? `, campanha ${c.campanha}` : ""})`,
    `Últimos 30 dias: investido ${dinheiro(c.gasto)}, ${inteiro(c.impressoes)} impressões, ${inteiro(c.resultados)} ${c.tipoResultado ?? "resultados"}, custo por resultado ${dinheiro(c.cpr)}, CTR ${pct(c.ctr)}, frequência ~${decimal(c.frequencia)}.`,
    `Média do cliente (${doCliente.length} anúncios): custo por resultado ${dinheiro(res ? gasto / res : null)}, CTR médio ${pct(media((x) => x.ctr))}.`,
  ];
  if (c.video) {
    L.push(`Vídeo: gancho (3 s ÷ impressões) ${pct(c.video.gancho)} vs média dos vídeos do cliente ${pct(media((x) => x.video?.gancho, videos))}; retenção (ThruPlay ÷ 3 s) ${pct(c.video.retencao)} vs média ${pct(media((x) => x.video?.retencao, videos))}; de quem deu play, chegaram a 25/50/75/100%: ${c.video.quartis.map((q) => `${Math.round(q)}%`).join(" / ")}.`);
  }
  if (c.selos.length) L.push(`Selos do painel: ${c.selos.join(", ")}.`);
  if (crm) {
    const f = crm.funil;
    const q = f.passos[0];
    L.push(`CRM (leads com este anúncio na UTM): ${inteiro(f.leads)} leads${q ? `, ${inteiro(q.valor)} ${q.nome.toLowerCase()}` : ""}, ${inteiro(f.vendas)} vendas${f.faturamento ? ` (${dinheiro(f.faturamento)})` : ""}.`);
  } else {
    L.push("CRM: sem leads cruzados com este anúncio (ou cliente sem CRM).");
  }
  return L.join("\n");
}

/** Analisa o criativo com a IA e guarda o resultado. */
export async function analisarCriativo(adId: string, clienteId: string): Promise<AnaliseCriativo> {
  const { atual, anterior } = resolverPeriodo({ p: "30" });
  const [todos, crmDet, { data: cri }] = await Promise.all([
    listarCriativos(atual, { clienteId }),
    detalheCrm(clienteId, atual, anterior).catch(() => null),
    db().from("criativos_meta").select("conta_id, tipo, video_id, imagem_url, thumbnail_url, texto, link").eq("ad_id", adId).maybeSingle(),
  ]);
  const c = todos.find((x) => x.id === adId);
  if (!c) throw new Error("Este anúncio não veiculou nos últimos 30 dias (a análise usa os números do período).");
  const criativo = cri as { conta_id: string; tipo: string | null; video_id: string | null; imagem_url: string | null; thumbnail_url: string | null; texto: string | null; link: string | null } | null;

  // CRM: leads com este anúncio na utm_content
  const crm = crmDet?.porUtm.utm_content.find((l) => l.nome !== "(sem UTM)" && (chaveDe(l.nome) === chaveDe(c.nome) || chaveDe(nomeDoAnuncio(l.nome)) === chaveDe(nomeDoAnuncio(c.nome)))) ?? null;

  const partes: ParteIA[] = [];
  let arquivoIA: string | null = null;
  try {
    if (c.formato === "video" && criativo?.video_id) {
      const { data: conta } = await db().from("contas_anuncio").select("*").eq("id", criativo.conta_id).maybeSingle();
      const token = conta ? await tokenDaConta(conta as ContaAnuncio) : undefined;
      if (!token) throw new Error("Sem token do Meta para baixar o vídeo.");
      const { fonte } = await fonteDoVideo(criativo.video_id, token);
      if (!fonte) throw new Error("O Meta não liberou o arquivo deste vídeo para análise.");
      const r = await fetch(fonte, { signal: AbortSignal.timeout(120_000) });
      if (!r.ok) throw new Error(`Não consegui baixar o vídeo do Meta (${r.status}).`);
      const tamanho = Number(r.headers.get("content-length") ?? 0);
      if (tamanho > LIMITE_VIDEO) throw new Error("Vídeo grande demais para analisar (acima de 200 MB).");
      const bytes = await r.arrayBuffer();
      const enviado = await enviarArquivoIA(bytes, r.headers.get("content-type")?.split(";")[0] || "video/mp4", c.nome);
      arquivoIA = enviado.nome;
      partes.push({ arquivo: { mime: enviado.mime, uri: enviado.uri } });
    } else {
      const url = criativo?.imagem_url || criativo?.thumbnail_url || c.miniatura;
      if (!url) throw new Error("Não achei a imagem deste anúncio.");
      const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error(`Não consegui baixar a imagem (${r.status}).`);
      const mime = r.headers.get("content-type")?.split(";")[0] || "image/jpeg";
      partes.push({ imagem: { mime, base64: Buffer.from(await r.arrayBuffer()).toString("base64") } });
      if (c.formato === "outro") partes.push({ texto: "Obs.: é um anúncio com várias mídias (carrossel ou dinâmico); você está vendo só a primeira imagem." });
    }
    partes.push({ texto: `Texto do anúncio:\n${criativo?.texto?.trim() || "(sem texto)"}\n\nNúmeros:\n${linhaNumeros(c, todos, crm)}` });

    const bruto = await perguntarIA(SISTEMA, partes, { json: true, temperatura: 0.4, tempoMs: 150_000 });
    let r: Partial<AnaliseCriativo> & { gancho?: Partial<AnaliseCriativo["gancho"]> };
    try {
      r = JSON.parse(bruto.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch {
      throw new Error("A IA respondeu num formato inesperado. Tente de novo.");
    }
    const lista = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 8) : []);
    const analise: AnaliseCriativo = {
      adId, nome: c.nome, formato: c.formato, criadoEm: new Date().toISOString(), periodo: atual.rotulo,
      nota: Math.max(0, Math.min(10, Math.round(Number(r.nota) || 0))),
      resumo: String(r.resumo ?? ""),
      gancho: {
        oQueAcontece: String(r.gancho?.oQueAcontece ?? ""),
        avaliacao: r.gancho?.avaliacao === "forte" || r.gancho?.avaliacao === "fraco" ? r.gancho.avaliacao : "medio",
        porque: String(r.gancho?.porque ?? ""),
      },
      estrutura: (Array.isArray(r.estrutura) ? r.estrutura : []).slice(0, 10).map((e) => ({ parte: String(e?.parte ?? ""), momento: String(e?.momento ?? ""), conteudo: String(e?.conteudo ?? "") })),
      falas: String(r.falas ?? ""),
      pontosFortes: lista(r.pontosFortes), pontosFracos: lista(r.pontosFracos), sugestoes: lista(r.sugestoes),
      numeros: String(r.numeros ?? ""),
    };
    await db().from("configuracoes").upsert({ chave: chave(adId), valor: analise, atualizado_em: analise.criadoEm });
    return analise;
  } finally {
    if (arquivoIA) await apagarArquivoIA(arquivoIA);
  }
}
