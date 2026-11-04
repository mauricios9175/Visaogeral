import "server-only";
import { db } from "./db";
import { buscarInteresses } from "./meta-montar";
import { tokenParaBusca } from "./token-busca";
import { perguntarIA } from "./ia";
import { CONFIG_GOOGLE_PADRAO, LIMITES, normalizarGoogle, type ConfigGoogle, type PalavraChave } from "./modelos-google";
import { CONJUNTO_PADRAO, CTAS, configDoZero, OBJETIVOS, type ConfigMeta, type ConjuntoMeta, type Interesse, type ObjetivoMeta } from "./modelos";

// Esboço de campanha com IA: a partir de uma frase ("formulário para loja de celulares"), a IA escolhe objetivo,
// públicos e escreve os textos. Os interesses passam pela busca do Meta: só entram os que existem de verdade.

type RespostaIA = {
  objetivo?: string;
  orcamentoDiario?: number | null;
  conjuntos?: { nome?: string; idadeMin?: number; idadeMax?: number; generos?: string; aberto?: boolean; interesses?: string[] }[];
  textos?: string[];
  titulos?: string[];
  descricao?: string;
  cta?: string;
  observacoes?: string;
  nome?: string;
};

const SISTEMA = `Você é um gestor de tráfego sênior no Brasil e monta campanhas no Meta Ads (Facebook/Instagram) para negócios locais.
A partir do pedido, monte o esboço de UMA campanha e responda SÓ com um JSON neste formato:
{
  "objetivo": "formulario" | "mensagens" | "site",
  "orcamentoDiario": número em reais por conjunto, ou null se o pedido não falar,
  "conjuntos": [
    { "nome": "nome curto do público", "idadeMin": 18-65, "idadeMax": 18-65, "generos": "todos" | "homens" | "mulheres",
      "aberto": true se for público aberto (Advantage+, sem interesses),
      "interesses": ["termos de interesse para buscar no Meta"] }
  ],
  "textos": ["3 variações do texto principal"],
  "titulos": ["4 variações de título"],
  "descricao": "descrição curta",
  "cta": "botão",
  "observacoes": "1 a 2 frases com dicas para o gestor (ex.: criativo sugerido)",
  "nome": "nome curto para salvar como modelo (ex.: Celulares – WhatsApp)"
}

Regras:
- objetivo: "formulario" para cadastro/formulário/lead; "mensagens" para WhatsApp/direct/conversa; "site" para site/landing page/pixel. Na dúvida, formulario.
- 2 ou 3 conjuntos: o primeiro aberto ("aberto": true, "interesses": []); os outros com 4 a 8 interesses cada, agrupados por tema.
- Interesses: termos que EXISTEM como interesse no Meta, em português, curtos (1 a 3 palavras), de marcas, categorias e comportamentos ligados ao nicho e ao público que compra. Ex. para loja de celulares: "iPhone", "Samsung Galaxy", "Smartphone", "Apple Inc.", "Xiaomi", "Acessórios para celular". Evite termos genéricos demais ("compras", "internet").
- Idade e gênero pelo perfil de quem compra; se não houver motivo, 25 a 55, todos.
- Textos em português do Brasil, para anúncio local: gancho na primeira linha, benefício claro, prova ou oferta (sem inventar preço, desconto ou dado que o pedido não trouxe; use [colchetes] para o gestor completar, ex.: [condição de pagamento]), chamada para ação coerente com o objetivo. 2 a 5 linhas, emojis com moderação.
- Títulos com até 40 caracteres. Descrição com até 30 caracteres.
- cta: um destes, conforme o objetivo — formulario: SIGN_UP, LEARN_MORE, GET_QUOTE, APPLY_NOW, CONTACT_US; mensagens: WHATSAPP_MESSAGE; site: LEARN_MORE, SIGN_UP, GET_QUOTE, CONTACT_US, SHOP_NOW.`;

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const corta = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);
const lista = (v: unknown, n: number, padrao: string[]) => {
  const l = (Array.isArray(v) ? v : []).map((t) => corta(t, n)).filter(Boolean).slice(0, 5);
  return l.length ? l : padrao;
};
const idade = (v: unknown, padrao: number) => Math.min(65, Math.max(18, Math.round(Number(v) || padrao)));

/** O interesse do Meta que corresponde ao termo: nome igual, depois parecido; senão o primeiro resultado. */
function melhor(termo: string, itens: Interesse[]): Interesse | null {
  const t = sem(termo);
  const so = itens.filter((x) => !x.tipo || x.tipo === "interests" || x.tipo === "behaviors");
  return so.find((x) => sem(x.nome) === t)
    ?? so.find((x) => sem(x.nome).includes(t) || t.includes(sem(x.nome)))
    ?? so[0] ?? null;
}

/** Roda as buscas de poucas em poucas (a API do Meta limita chamadas seguidas). */
async function emLotes<T, R>(itens: T[], n: number, f: (x: T) => Promise<R>) {
  const saida: R[] = [];
  for (let i = 0; i < itens.length; i += n) saida.push(...(await Promise.all(itens.slice(i, i + n).map(f))));
  return saida;
}

export type Esboco = { objetivo: ObjetivoMeta; config: ConfigMeta; naoEncontrados: string[]; observacoes: string; nome: string };

/** Contexto do pedido: o cliente (quando há) e o pedido do gestor. */
async function contextoDo(clienteId: string | null, pedido: string) {
  if (!clienteId) return `Pedido do gestor (é um MODELO reutilizável, sem cliente específico): ${pedido}`;
  const { data: cliente } = await db().from("clientes").select("nome, nicho").eq("id", clienteId).maybeSingle();
  if (!cliente) throw new Error("Cliente não encontrado.");
  return `Cliente: ${cliente.nome}${cliente.nicho ? ` (nicho cadastrado: ${cliente.nicho})` : ""}\nPedido do gestor: ${pedido}`;
}

const lerJson = <T>(bruto: string): T => {
  try {
    return JSON.parse(bruto.replace(/^```(?:json)?\s*|\s*```$/g, "")) as T;
  } catch {
    throw new Error("A IA respondeu num formato inesperado. Tente de novo.");
  }
};

/** Monta o esboço (nada é publicado: ele só preenche a tela de montagem). */
export async function esbocarCampanha(clienteId: string | null, pedido: string, contaId?: string | null): Promise<Esboco> {
  const r = lerJson<RespostaIA>(await perguntarIA(SISTEMA, await contextoDo(clienteId, pedido), { json: true, temperatura: 0.7 }));

  const objetivo: ObjetivoMeta = r.objetivo && r.objetivo in OBJETIVOS ? (r.objetivo as ObjetivoMeta) : "formulario";
  const base = configDoZero(objetivo);
  const orcamento = Number(r.orcamentoDiario) > 0 ? Math.round(Number(r.orcamentoDiario)) : CONJUNTO_PADRAO.orcamentoDiario;

  // interesses: cada termo vira o interesse real do Meta (ou fica de fora, avisando)
  const { token, conta } = await tokenParaBusca(contaId ?? null);
  const termos = [...new Set((r.conjuntos ?? []).flatMap((c) => (c.aberto ? [] : c.interesses ?? []).map((t) => corta(t, 60)).filter(Boolean)))].slice(0, 24);
  const achados = new Map<string, Interesse | null>();
  if (token && termos.length) {
    await emLotes(termos, 4, async (t) => {
      achados.set(t, melhor(t, await buscarInteresses(t, token, conta).catch(() => [])));
    });
  }
  const naoEncontrados = termos.filter((t) => !achados.get(t));

  const conjuntos: ConjuntoMeta[] = (r.conjuntos ?? []).slice(0, 4).map((c, i) => {
    const vistos = new Set<string>();
    const interesses = c.aberto ? [] : (c.interesses ?? []).map((t) => achados.get(corta(t, 60)))
      .filter((x): x is Interesse => !!x && !vistos.has(x.id) && !!vistos.add(x.id));
    const min = idade(c.idadeMin, 25), max = idade(c.idadeMax, 55);
    return {
      ...CONJUNTO_PADRAO,
      nome: `{cidade} - ${corta(c.nome, 40) || (c.aberto ? "Aberto" : `Interesses ${i}`)}`,
      orcamentoDiario: orcamento,
      idadeMin: Math.min(min, max), idadeMax: Math.max(min, max),
      generos: c.generos === "homens" || c.generos === "mulheres" ? c.generos : "todos",
      // público aberto (ou sem nenhum interesse achado) fica com o Advantage+
      advantage: Boolean(c.aberto) || !interesses.length,
      interesses,
    };
  });

  const ctas = CTAS[objetivo].map((x) => x.valor);
  return {
    objetivo,
    naoEncontrados,
    nome: corta(r.nome, 80),
    observacoes: corta(r.observacoes, 400) + (!token ? " (Não deu para buscar os interesses no Meta: conecte o Facebook em Configurações.)" : ""),
    config: {
      ...base,
      orcamentoDiario: orcamento,
      conjuntos: conjuntos.length ? conjuntos : base.conjuntos,
      textos: lista(r.textos, 2000, base.textos),
      titulos: lista(r.titulos, 60, base.titulos),
      descricao: corta(r.descricao, 60),
      cta: r.cta && ctas.includes(r.cta) ? r.cta : ctas[0],
    },
  };
}

// ---------- Google Ads (Pesquisa) ----------

const SISTEMA_GOOGLE = `Você é um gestor de tráfego sênior no Brasil e monta campanhas de PESQUISA no Google Ads para negócios locais.
A partir do pedido, monte o esboço de UMA campanha e responda SÓ com um JSON neste formato:
{
  "nome": "nome curto para salvar como modelo (ex.: Celulares – Pesquisa)",
  "orcamentoDiario": número em reais, ou null se o pedido não falar,
  "lance": "maximizar_conversoes" | "maximizar_cliques",
  "grupos": [ { "nome": "tema do grupo", "palavras": [ { "texto": "palavra-chave", "correspondencia": "FRASE" | "EXATA" | "AMPLA" } ] } ],
  "negativas": ["termos negativos"],
  "titulos": ["12 a 15 títulos"],
  "descricoes": ["4 descrições"],
  "caminho1": "palavra do link",
  "caminho2": "palavra do link",
  "observacoes": "1 a 2 frases com dicas para o gestor"
}

Regras:
- 2 a 4 grupos por tema/intenção (ex.: produto, serviço, "perto de mim", marca/modelo). 6 a 15 palavras por grupo.
- Palavras com intenção de compra/contratação, do jeito que as pessoas pesquisam no Brasil (ex.: "loja de celular", "iphone 13 usado", "conserto de celular perto de mim"). Use principalmente FRASE e EXATA; AMPLA só para termos bem específicos.
- Negativas: 10 a 25 termos que trazem clique sem intenção de compra (grátis, vagas, emprego, curso, como fazer, pdf, download, mercado livre, olx, conserto se a loja só vende etc.), coerentes com o nicho.
- Títulos com NO MÁXIMO 30 caracteres (conte os espaços); variados: produto + benefício, cidade/região, diferencial, chamada para ação, prova. Pelo menos 3 citando a palavra principal.
- Descrições com NO MÁXIMO 90 caracteres, com benefício e chamada para ação.
- Não invente preço, desconto ou dado que o pedido não trouxe; use [colchetes] para o gestor completar.
- caminho1 e caminho2: até 15 caracteres, sem espaço (ex.: "celulares", "iphone").
- Português do Brasil.`;

type RespostaGoogle = {
  nome?: string; orcamentoDiario?: number | null; lance?: string;
  grupos?: { nome?: string; palavras?: ({ texto?: string; correspondencia?: string } | string)[] }[];
  negativas?: string[]; titulos?: string[]; descricoes?: string[]; caminho1?: string; caminho2?: string; observacoes?: string;
};

export type EsbocoGoogle = { config: ConfigGoogle; nome: string; observacoes: string; cortados: number };

/** Esboço de campanha de Pesquisa: grupos, palavras-chave, negativas e anúncio responsivo. Nada é publicado. */
export async function esbocarGoogle(clienteId: string | null, pedido: string): Promise<EsbocoGoogle> {
  const r = lerJson<RespostaGoogle>(await perguntarIA(SISTEMA_GOOGLE, await contextoDo(clienteId, pedido), { json: true, temperatura: 0.7 }));
  const textos = (v: unknown, limite: number, max: number) => {
    const todos = (Array.isArray(v) ? v : []).map((t) => String(t ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
    const ok = [...new Set(todos.filter((t) => t.length <= limite))].slice(0, max);
    return { ok, cortados: todos.length - ok.length };
  };
  const t = textos(r.titulos, LIMITES.titulo, LIMITES.titulos);
  const d = textos(r.descricoes, LIMITES.descricao, LIMITES.descricoes);
  const caminho = (x: unknown) => String(x ?? "").replace(/\s+/g, "-").slice(0, LIMITES.caminho);
  const config = normalizarGoogle({
    ...CONFIG_GOOGLE_PADRAO,
    orcamentoDiario: Number(r.orcamentoDiario) > 0 ? Math.round(Number(r.orcamentoDiario)) : CONFIG_GOOGLE_PADRAO.orcamentoDiario,
    lance: r.lance === "maximizar_cliques" ? "maximizar_cliques" : "maximizar_conversoes",
    grupos: (r.grupos ?? []).slice(0, 6).map((g) => ({
      nome: corta(g.nome, 60) || "Grupo",
      palavras: (g.palavras ?? []).slice(0, 25).map((p) => (typeof p === "string" ? { texto: p, correspondencia: "FRASE" } : p)) as PalavraChave[],
    })),
    negativas: (r.negativas ?? []).slice(0, 40).map((x) => ({ texto: String(x), correspondencia: "AMPLA" as const })),
    titulos: t.ok.length >= 3 ? t.ok : [...t.ok, "", "", ""].slice(0, 3),
    descricoes: d.ok.length >= 2 ? d.ok : [...d.ok, "", ""].slice(0, 2),
    caminho1: caminho(r.caminho1), caminho2: caminho(r.caminho2),
  });
  return { config, nome: corta(r.nome, 80), observacoes: corta(r.observacoes, 400), cortados: t.cortados + d.cortados };
}
