import "server-only";
import { db } from "./db";
import { detalheCrm, type NumerosCrm } from "./consultas";
import { listarCriativos, type Criativo } from "./criativos";
import { hojeISO, resolverPeriodo, somarDias } from "./datas";
import { dinheiro, inteiro, pct } from "./formato";
import { perguntarIA, type ParteIA } from "./ia";
import { lerAnaliseCriativo } from "./analise-criativo";
import { chaveDe, nomeDoAnuncio } from "./agrupar";
import { briefingDoCliente } from "./ficha";

// "Por que os vencedores ganham": compara os criativos que mais trazem resultado (de preferência venda no CRM)
// com os que menos trazem, no mesmo cliente, e a IA explica o padrão: gancho, formato, oferta, texto, estrutura.
// Usa os números, o texto, a miniatura e as análises individuais já feitas. Fica salvo ("vencedores:<cliente>").

export type ItemComparado = { id: string; nome: string; formato: string; miniatura: string | null; resumoNumeros: string };

export type AnaliseVencedores = {
  clienteId: string;
  criadoEm: string;
  periodo: string;
  criterio: string;                 // como os vencedores foram escolhidos
  vencedores: ItemComparado[];
  perdedores: ItemComparado[];
  resumo: string;
  padroesVencedores: string[];
  padroesPerdedores: string[];
  diferencas: string[];             // o que separa um grupo do outro
  receita: string[];                // como fazer o próximo criativo
  testes: { hipotese: string; como: string }[];
  ressalvas: string;
  semAnalise: number;               // quantos dos comparados ainda não têm análise individual (com vídeo assistido)
};

const DIAS = 90;
const MAX_POR_GRUPO = 6;
const chave = (clienteId: string) => `vencedores:${clienteId}`;

export async function lerVencedores(clienteId: string): Promise<AnaliseVencedores | null> {
  const { data } = await db().from("configuracoes").select("valor").eq("chave", chave(clienteId)).maybeSingle();
  return (data?.valor as AnaliseVencedores | undefined) ?? null;
}

const SISTEMA = `Você é um estrategista de criativos de anúncios (Meta Ads) para negócios locais no Brasil.
Vai receber dois grupos de criativos do MESMO cliente no mesmo período: os VENCEDORES (V1, V2…) e os PERDEDORES (P1, P2…),
com números, texto do anúncio, miniatura (imagens na mesma ordem) e, quando houver, a análise individual feita antes (com o vídeo assistido).
Descubra o que os vencedores têm em comum e o que os separa dos perdedores. Seja específico: cite V1, P2 etc. como evidência.
Olhe: gancho (primeiros segundos/primeira impressão), formato (vídeo/imagem, pessoa falando, antes e depois, produto), oferta e promessa,
prova (depoimento, números), público aparente, texto e chamada para ação, duração/ritmo, e a qualidade do lead (CRM), não só o custo.
Responda SÓ com JSON:
{
  "resumo": "2 a 3 frases: a principal razão de os vencedores ganharem",
  "padroesVencedores": ["padrão + evidência (ex.: 'mostram o resultado final nos 2 primeiros segundos (V1, V3)')"],
  "padroesPerdedores": ["padrão + evidência"],
  "diferencas": ["o que separa os grupos, do mais importante para o menos"],
  "receita": ["passo a passo do próximo criativo para este cliente: gancho, formato, roteiro, oferta, texto, CTA"],
  "testes": [{ "hipotese": "o que testar e por quê", "como": "como montar o teste (criativos, variação, quanto investir, como medir)" }],
  "ressalvas": "limites da conclusão (pouco volume, datas diferentes, públicos diferentes, sem vídeo assistido…)"
}
Português do Brasil, direto. Não invente números. 3 a 6 itens por lista; 2 a 4 testes.`;

/** O mesmo anúncio na UTM do CRM (utm_content com o nome do anúncio). */
function crmDoAnuncio(c: Criativo, crm: { porUtm: { utm_content: { nome: string; funil: NumerosCrm["funil"] }[] } } | null) {
  return crm?.porUtm.utm_content.find((l) => l.nome !== "(sem UTM)" && (chaveDe(l.nome) === chaveDe(c.nome) || chaveDe(nomeDoAnuncio(l.nome)) === chaveDe(nomeDoAnuncio(c.nome))))?.funil ?? null;
}

export async function analisarVencedores(clienteId: string): Promise<AnaliseVencedores> {
  const hoje = hojeISO();
  const { atual, anterior } = resolverPeriodo({ p: "livre", de: somarDias(hoje, -DIAS), ate: somarDias(hoje, -1) });
  const [todos, crm, briefing, { data: cliente }] = await Promise.all([
    listarCriativos(atual, { clienteId }),
    detalheCrm(clienteId, atual, anterior).catch(() => null),
    briefingDoCliente(clienteId).catch(() => ""),
    db().from("clientes").select("nome, nicho").eq("id", clienteId).maybeSingle(),
  ]);
  if (!cliente) throw new Error("Cliente não encontrado.");

  // só quem teve investimento para dizer alguma coisa: pelo menos R$ 30 e 1,5x o custo médio por resultado
  const gastoTotal = todos.reduce((t, c) => t + c.gasto, 0);
  const resTotal = todos.reduce((t, c) => t + c.resultados, 0);
  const cprMedio = resTotal ? gastoTotal / resTotal : null;
  const minimo = Math.max(30, (cprMedio ?? 20) * 1.5);
  const com = todos.filter((c) => c.gasto >= minimo).map((c) => ({ c, crm: crmDoAnuncio(c, crm) }));
  if (com.length < 4) {
    throw new Error(`Poucos criativos com investimento suficiente nos últimos ${DIAS} dias (${com.length} com pelo menos ${dinheiro(minimo)}). Precisa de pelo menos 4 para comparar.`);
  }

  // critério: vendas do CRM por real investido; sem vendas, o 1º passo do funil (qualificados); sem CRM, custo por resultado
  const vendasTotal = com.reduce((t, x) => t + (x.crm?.vendas ?? 0), 0);
  const qualTotal = com.reduce((t, x) => t + (x.crm?.passos[0]?.valor ?? 0), 0);
  const nomeQual = com.find((x) => x.crm?.passos[0])?.crm?.passos[0]?.nome ?? "qualificados";
  const [criterio, nota] = vendasTotal >= 3
    ? ["vendas no CRM por real investido", (x: (typeof com)[number]) => (x.crm?.vendas ?? 0) / x.c.gasto] as const
    : qualTotal >= 5
      ? [`${nomeQual.toLowerCase()} no CRM por real investido`, (x: (typeof com)[number]) => (x.crm?.passos[0]?.valor ?? 0) / x.c.gasto] as const
      : ["resultados por real investido (menor custo por resultado)", (x: (typeof com)[number]) => x.c.resultados / x.c.gasto] as const;
  const ordenados = [...com].sort((a, b) => nota(b) - nota(a) || b.c.resultados - a.c.resultados);
  const n = Math.max(2, Math.min(MAX_POR_GRUPO, Math.round(com.length / 4)));
  const vencedores = ordenados.slice(0, n).filter((x) => nota(x) > 0);
  if (vencedores.length < 2) throw new Error("Não deu para separar vencedores: quase nenhum criativo trouxe resultado no período.");
  // perdedores: os piores entre os que mais gastaram (gastar e não trazer é o que interessa evitar)
  const perdedores = ordenados.slice(-Math.max(n, 2)).filter((x) => !vencedores.includes(x)).sort((a, b) => b.c.gasto - a.c.gasto).slice(0, n);

  const analises = new Map(await Promise.all([...vencedores, ...perdedores].map(async (x) => [x.c.id, await lerAnaliseCriativo(x.c.id).catch(() => null)] as const)));
  const { data: textos } = await db().from("criativos_meta").select("ad_id, texto, titulo, thumbnail_url, imagem_url").in("ad_id", [...vencedores, ...perdedores].map((x) => x.c.id));
  const porAd = new Map(((textos ?? []) as { ad_id: string; texto: string | null; titulo: string | null; thumbnail_url: string | null; imagem_url: string | null }[]).map((t) => [t.ad_id, t]));

  const numeros = (x: (typeof com)[number]) => {
    const c = x.c;
    const partes = [`investido ${dinheiro(c.gasto)}`, `${inteiro(c.resultados)} ${c.tipoResultado ?? "resultados"} (custo ${dinheiro(c.cpr)})`, `CTR ${pct(c.ctr)}`];
    if (c.video) partes.push(`gancho ${pct(c.video.gancho)}`, `retenção ${pct(c.video.retencao)}`);
    if (x.crm) partes.push(`CRM: ${inteiro(x.crm.leads)} leads${x.crm.passos[0] ? `, ${inteiro(x.crm.passos[0].valor)} ${x.crm.passos[0].nome.toLowerCase()}` : ""}, ${inteiro(x.crm.vendas)} vendas${x.crm.faturamento ? ` (${dinheiro(x.crm.faturamento)})` : ""}`);
    return partes.join(" · ");
  };
  const bloco = (x: (typeof com)[number], rotulo: string) => {
    const t = porAd.get(x.c.id);
    const a = analises.get(x.c.id);
    return [
      `${rotulo}: “${x.c.nome}” (${x.c.formato === "video" ? "vídeo" : x.c.formato === "imagem" ? "imagem" : "carrossel/dinâmico"}${x.c.campanha ? `, campanha ${x.c.campanha}` : ""})`,
      `Números: ${numeros(x)}`,
      t?.titulo ? `Título: ${t.titulo}` : "",
      `Texto do anúncio: ${(t?.texto ?? x.c.texto ?? "(sem texto)").replace(/\s+/g, " ").slice(0, 500)}`,
      a ? `Análise individual (nota ${a.nota}/10): ${a.resumo} | Gancho: ${a.gancho.oQueAcontece} (${a.gancho.avaliacao}) | Estrutura: ${a.estrutura.map((e) => `${e.parte}: ${e.conteudo}`).join("; ").slice(0, 600)}${a.falas ? ` | Falas: ${a.falas.slice(0, 300)}` : ""}` : "Análise individual: ainda não feita (só a miniatura).",
    ].filter(Boolean).join("\n");
  };

  // miniaturas na mesma ordem (V1…, P1…), cada uma com o rótulo antes
  const partes: ParteIA[] = [];
  const grupos = [...vencedores.map((x, i) => [x, `V${i + 1}`] as const), ...perdedores.map((x, i) => [x, `P${i + 1}`] as const)];
  await Promise.all(grupos.map(async ([x, rotulo]) => {
    const url = porAd.get(x.c.id)?.imagem_url || porAd.get(x.c.id)?.thumbnail_url || x.c.miniatura;
    if (!url) return;
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (!r?.ok) return;
    partes.push({ texto: `Miniatura de ${rotulo}:` }, { imagem: { mime: r.headers.get("content-type")?.split(";")[0] || "image/jpeg", base64: Buffer.from(await r.arrayBuffer()).toString("base64") } });
  }));
  // a ordem das imagens pode ter mudado com o Promise.all: cada uma vem com o rótulo logo antes, então tudo bem
  partes.push({ texto: [
    `Cliente: ${cliente.nome}${cliente.nicho ? ` (nicho: ${cliente.nicho})` : ""}. Período: ${atual.desde} a ${atual.ate}.`,
    briefing ? `Briefing do cliente:\n${briefing.slice(0, 2000)}` : "",
    `Critério de vencedor: ${criterio}. Média do cliente: custo por resultado ${dinheiro(cprMedio)}.`,
    `=== VENCEDORES ===\n${vencedores.map((x, i) => bloco(x, `V${i + 1}`)).join("\n\n")}`,
    `=== PERDEDORES ===\n${perdedores.map((x, i) => bloco(x, `P${i + 1}`)).join("\n\n")}`,
  ].filter(Boolean).join("\n\n") });

  const bruto = await perguntarIA(SISTEMA, partes, { json: true, temperatura: 0.4, tempoMs: 150_000 });
  let r: Partial<AnaliseVencedores>;
  try {
    r = JSON.parse(bruto.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new Error("A IA respondeu num formato inesperado. Tente de novo.");
  }
  const lista = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 8) : []);
  const item = (x: (typeof com)[number]): ItemComparado => ({ id: x.c.id, nome: x.c.nome, formato: x.c.formato, miniatura: x.c.miniatura, resumoNumeros: numeros(x) });
  const resultado: AnaliseVencedores = {
    clienteId, criadoEm: new Date().toISOString(), periodo: `últimos ${DIAS} dias (${atual.desde.split("-").reverse().join("/")} a ${atual.ate.split("-").reverse().join("/")})`,
    criterio, vencedores: vencedores.map(item), perdedores: perdedores.map(item),
    resumo: String(r.resumo ?? ""),
    padroesVencedores: lista(r.padroesVencedores), padroesPerdedores: lista(r.padroesPerdedores),
    diferencas: lista(r.diferencas), receita: lista(r.receita),
    testes: (Array.isArray(r.testes) ? r.testes : []).slice(0, 5).map((t) => ({ hipotese: String(t?.hipotese ?? ""), como: String(t?.como ?? "") })).filter((t) => t.hipotese),
    ressalvas: String(r.ressalvas ?? ""),
    semAnalise: [...vencedores, ...perdedores].filter((x) => !analises.get(x.c.id)).length,
  };
  await db().from("configuracoes").upsert({ chave: chave(clienteId), valor: resultado, atualizado_em: resultado.criadoEm });
  return resultado;
}
