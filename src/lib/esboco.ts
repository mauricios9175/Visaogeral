import "server-only";
import { db } from "./db";
import { buscarInteresses } from "./meta-montar";
import { tokenParaBusca } from "./token-busca";
import { perguntarIA } from "./ia";
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
  "observacoes": "1 a 2 frases com dicas para o gestor (ex.: criativo sugerido)"
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

export type Esboco = { objetivo: ObjetivoMeta; config: ConfigMeta; naoEncontrados: string[]; observacoes: string };

/** Monta o esboço (nada é publicado: ele só preenche a tela de montagem). */
export async function esbocarCampanha(clienteId: string, pedido: string, contaId?: string | null): Promise<Esboco> {
  const { data: cliente } = await db().from("clientes").select("nome, nicho").eq("id", clienteId).maybeSingle();
  if (!cliente) throw new Error("Cliente não encontrado.");
  const contexto = `Cliente: ${cliente.nome}${cliente.nicho ? ` (nicho cadastrado: ${cliente.nicho})` : ""}\nPedido do gestor: ${pedido}`;
  const bruto = await perguntarIA(SISTEMA, contexto, { json: true, temperatura: 0.7 });
  let r: RespostaIA;
  try {
    r = JSON.parse(bruto.replace(/^```(?:json)?\s*|\s*```$/g, "")) as RespostaIA;
  } catch {
    throw new Error("A IA respondeu num formato inesperado. Tente de novo.");
  }

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
