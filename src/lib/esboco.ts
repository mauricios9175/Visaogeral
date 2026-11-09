import "server-only";
import { db } from "./db";
import { buscarInteresses } from "./meta-montar";
import { tokenParaBusca } from "./token-busca";
import { perguntarIA } from "./ia";
import { CONFIG_GOOGLE_PADRAO, LIMITES, normalizarGoogle, type ConfigGoogle, type PalavraChave } from "./modelos-google";
import { WHATSAPP_PADRAO, CONJUNTO_PADRAO, CTAS, configDoZero, OBJETIVOS, type ConfigMeta, type ConjuntoMeta, type Interesse, type ObjetivoMeta } from "./modelos";

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
  whatsapp?: { saudacao?: string; tipo?: string; preenchida?: string; perguntas?: string[] };
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
  "nome": "nome curto para salvar como modelo (ex.: Celulares – WhatsApp)",
  "whatsapp": { "saudacao": "saudação curta que a pessoa recebe no WhatsApp", "tipo": "preenchida" | "perguntas", "preenchida": "mensagem que já vem escrita para a pessoa enviar", "perguntas": ["até 4 perguntas rápidas"] } (só no objetivo mensagens)
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
      ...(objetivo === "mensagens" && r.whatsapp ? {
        whatsapp: {
          saudacao: corta(r.whatsapp.saudacao, 300) || WHATSAPP_PADRAO.saudacao,
          tipo: r.whatsapp.tipo === "perguntas" && r.whatsapp.perguntas?.length ? "perguntas" as const : "preenchida" as const,
          preenchida: corta(r.whatsapp.preenchida, 300) || WHATSAPP_PADRAO.preenchida,
          perguntas: (r.whatsapp.perguntas ?? []).map((x) => corta(x, 80)).filter(Boolean).slice(0, 4),
        },
      } : {}),
    },
  };
}

// ---------- Google Ads (Pesquisa e Performance Max) ----------

const SISTEMA_GOOGLE = `Você é um gestor de tráfego sênior no Brasil e monta campanhas no Google Ads para negócios locais.
A partir do pedido, monte o esboço de UMA campanha e responda SÓ com um JSON neste formato:
{
  "tipo": "pesquisa" | "pmax",
  "nome": "nome curto para salvar como modelo (ex.: Celulares – Pesquisa)",
  "orcamentoDiario": número em reais, ou null se o pedido não falar,
  "lance": "maximizar_conversoes" | "maximizar_cliques",
  "grupos": [
    { "nome": "tema do grupo",
      "palavras": [ { "texto": "palavra-chave", "correspondencia": "FRASE" | "EXATA" | "AMPLA" } ],
      "titulos": ["12 a 15 títulos DESTE grupo"],
      "descricoes": ["4 descrições DESTE grupo"],
      "caminho1": "palavra do link", "caminho2": "palavra do link" }
  ],
  "negativas": ["termos negativos"],
  "pmax": { "nomeEmpresa": "nome da empresa", "titulos": ["15 títulos"], "titulosLongos": ["5 títulos longos"], "descricoes": ["5 descrições"], "temas": ["até 25 temas de pesquisa"] },
  "sitelinks": [ { "texto": "texto do link", "descricao1": "linha 1", "descricao2": "linha 2" } ],
  "frases": ["frases de destaque"],
  "observacoes": "1 a 2 frases com dicas para o gestor"
}

Regras gerais:
- tipo "pmax" só se o pedido falar em Performance Max/PMax; senão "pesquisa". Em "pesquisa", "pmax" pode vir vazio; em "pmax", "grupos" e "negativas" podem vir vazios.
- Não invente preço, desconto ou dado que o pedido não trouxe; use [colchetes] para o gestor completar. Português do Brasil.
- Conte os caracteres (com espaços) e respeite os limites. Texto acima do limite é descartado.
- 4 sitelinks (texto até 25; descricao1 e descricao2 até 35 cada) para páginas/ações úteis (ex.: Fale no WhatsApp, Nossos produtos, Como chegar, Avaliações).
- 4 a 6 frases de destaque, até 25 caracteres (ex.: "Garantia de 90 dias", "Atendimento rápido").

Pesquisa:
- 2 a 4 grupos por tema/intenção (ex.: produto, serviço, "perto de mim", marca/modelo), 6 a 15 palavras por grupo, como as pessoas pesquisam no Brasil, com intenção de compra/contratação. Use principalmente FRASE e EXATA; AMPLA só para termos bem específicos.
- CADA grupo tem o seu anúncio: títulos (até 30) que repetem e conversam com as palavras DESSE grupo (pelo menos 3 com a palavra principal do grupo), variados (benefício, cidade/região, diferencial, chamada para ação, prova). Descrições até 90, com benefício e chamada para ação.
- caminho1/caminho2 do grupo: até 15 caracteres, sem espaço (ex.: "celulares", "iphone").
- Negativas: 10 a 25 termos que trazem clique sem intenção de compra (grátis, vagas, emprego, curso, como fazer, pdf, download, olx etc.), coerentes com o nicho.

Performance Max:
- nomeEmpresa até 25 caracteres. 15 títulos até 30. 5 títulos longos até 90. 5 descrições até 90, e pelo menos uma até 60.
- temas: até 25 termos que o cliente ideal pesquisa (sinal para o Google).`;

type TextosIA = { titulos?: string[]; descricoes?: string[] };
type RespostaGoogle = {
  tipo?: string; nome?: string; orcamentoDiario?: number | null; lance?: string;
  grupos?: (TextosIA & { nome?: string; palavras?: ({ texto?: string; correspondencia?: string } | string)[]; caminho1?: string; caminho2?: string })[];
  negativas?: string[];
  pmax?: TextosIA & { nomeEmpresa?: string; titulosLongos?: string[]; temas?: string[] };
  sitelinks?: { texto?: string; descricao1?: string; descricao2?: string }[];
  frases?: string[];
  observacoes?: string;
};

export type EsbocoGoogle = { config: ConfigGoogle; nome: string; observacoes: string; cortados: number };

/** Esboço de campanha do Google (Pesquisa com anúncio por grupo, ou Performance Max), com sitelinks e frases. Nada é publicado. */
export async function esbocarGoogle(clienteId: string | null, pedido: string): Promise<EsbocoGoogle> {
  const r = lerJson<RespostaGoogle>(await perguntarIA(SISTEMA_GOOGLE, await contextoDo(clienteId, pedido), { json: true, temperatura: 0.7 }));
  let cortados = 0;
  const textos = (v: unknown, limite: number, max: number, min = 0) => {
    const todos = (Array.isArray(v) ? v : []).map((t) => String(t ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
    const ok = [...new Set(todos.filter((t) => t.length <= limite))].slice(0, max);
    cortados += todos.filter((t) => t.length > limite).length;
    while (ok.length < min) ok.push("");
    return ok;
  };
  const caminho = (x: unknown) => String(x ?? "").replace(/\s+/g, "-").slice(0, LIMITES.caminho);
  const pmax = r.tipo === "pmax" || /performance max|pmax/i.test(pedido);
  const config = normalizarGoogle({
    ...CONFIG_GOOGLE_PADRAO,
    tipo: pmax ? "pmax" : "pesquisa",
    nomeCampanha: pmax ? "[PMax] {cliente} - {data}" : CONFIG_GOOGLE_PADRAO.nomeCampanha,
    orcamentoDiario: Number(r.orcamentoDiario) > 0 ? Math.round(Number(r.orcamentoDiario)) : CONFIG_GOOGLE_PADRAO.orcamentoDiario,
    lance: !pmax && r.lance === "maximizar_cliques" ? "maximizar_cliques" : "maximizar_conversoes",
    grupos: pmax ? undefined : (r.grupos ?? []).slice(0, 6).map((g) => ({
      nome: corta(g.nome, 60) || "Grupo",
      palavras: (g.palavras ?? []).slice(0, 25).map((p) => (typeof p === "string" ? { texto: p, correspondencia: "FRASE" } : p)) as PalavraChave[],
      titulos: textos(g.titulos, LIMITES.titulo, LIMITES.titulos, 3),
      descricoes: textos(g.descricoes, LIMITES.descricao, LIMITES.descricoes, 2),
      url: "", caminho1: caminho(g.caminho1), caminho2: caminho(g.caminho2),
    })),
    negativas: pmax ? [] : (r.negativas ?? []).slice(0, 40).map((x) => ({ texto: String(x), correspondencia: "AMPLA" as const })),
    pmax: pmax ? {
      nomeEmpresa: corta(r.pmax?.nomeEmpresa, LIMITES.nomeEmpresa),
      titulos: textos(r.pmax?.titulos, LIMITES.titulo, LIMITES.titulos, 3),
      titulosLongos: textos(r.pmax?.titulosLongos, LIMITES.tituloLongo, LIMITES.titulosLongos, 1),
      descricoes: textos(r.pmax?.descricoes, LIMITES.descricao, LIMITES.descricoesPmax, 2),
      temas: (r.pmax?.temas ?? []).map((t) => corta(t, 80)).filter(Boolean).slice(0, LIMITES.temas),
    } : undefined,
    sitelinks: (r.sitelinks ?? []).slice(0, LIMITES.sitelinks)
      .filter((x) => x?.texto && String(x.texto).length <= LIMITES.sitelinkTexto)
      .map((x) => {
        const d1 = corta(x.descricao1, 100), d2 = corta(x.descricao2, 100);
        const ok = d1 && d2 && d1.length <= LIMITES.sitelinkDescricao && d2.length <= LIMITES.sitelinkDescricao;
        return { texto: corta(x.texto, LIMITES.sitelinkTexto), descricao1: ok ? d1 : "", descricao2: ok ? d2 : "", url: "" };
      }),
    frases: textos(r.frases, LIMITES.frase, LIMITES.frases),
  });
  return { config, nome: corta(r.nome, 80), observacoes: corta(r.observacoes, 400), cortados };
}

// ---------- Anúncio novo para um grupo que já existe (Google) ----------

const SISTEMA_ANUNCIO = `Você é um gestor de tráfego sênior no Brasil e escreve anúncios responsivos de pesquisa no Google Ads.
Responda SÓ com um JSON: { "titulos": ["15 títulos"], "descricoes": ["4 descrições"], "caminho1": "palavra", "caminho2": "palavra" }
Regras:
- Títulos com NO MÁXIMO 30 caracteres (conte os espaços); descrições com NO MÁXIMO 90. Texto acima do limite é descartado.
- Os títulos conversam com as palavras-chave do grupo: pelo menos 4 repetem a palavra principal; os outros variam (benefício, diferencial, região, chamada para ação, prova).
- Se houver anúncios atuais, traga ângulos NOVOS (é para testar contra eles), sem repetir os mesmos títulos.
- Não invente preço, desconto ou dado que não foi dado; use [colchetes] para o gestor completar. Português do Brasil.
- caminho1/caminho2: até 15 caracteres, sem espaço.`;

/** Títulos, descrições e caminhos de um anúncio novo para o grupo, a partir das palavras-chave dele. */
export async function esbocarAnuncioGoogle(clienteId: string | null, grupo: string, palavras: string[], atuais: string[], pedido: string) {
  const contexto = `${await contextoDo(clienteId, pedido || "anúncio novo para testar no grupo")}\nGrupo: ${grupo}\nPalavras-chave do grupo: ${palavras.slice(0, 40).join(", ") || "(não informadas)"}` +
    (atuais.length ? `\nTítulos dos anúncios atuais: ${atuais.slice(0, 20).join(" | ")}` : "");
  const r = lerJson<{ titulos?: string[]; descricoes?: string[]; caminho1?: string; caminho2?: string }>(await perguntarIA(SISTEMA_ANUNCIO, contexto, { json: true, temperatura: 0.8 }));
  const ok = (v: unknown, lim: number, max: number) => [...new Set((Array.isArray(v) ? v : []).map((t) => String(t ?? "").replace(/\s+/g, " ").trim()).filter((t) => t && t.length <= lim))].slice(0, max);
  const caminho = (x: unknown) => String(x ?? "").replace(/\s+/g, "-").slice(0, LIMITES.caminho);
  return { titulos: ok(r.titulos, LIMITES.titulo, LIMITES.titulos), descricoes: ok(r.descricoes, LIMITES.descricao, LIMITES.descricoes), caminho1: caminho(r.caminho1), caminho2: caminho(r.caminho2) };
}
