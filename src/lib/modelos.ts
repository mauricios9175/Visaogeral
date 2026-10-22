// Modelos de campanha do Meta. Arquivo sem "server-only": os tipos e padrões também são usados nos formulários.

export type ObjetivoMeta = "formulario" | "mensagens" | "site";

export const OBJETIVOS: Record<ObjetivoMeta, { rotulo: string; descricao: string }> = {
  formulario: { rotulo: "Formulário (cadastro)", descricao: "Campanha de Leads com formulário instantâneo do Meta" },
  mensagens: { rotulo: "Mensagens no WhatsApp", descricao: "Campanha de Engajamento com destino WhatsApp" },
  site: { rotulo: "Leads no site", descricao: "Campanha de Leads otimizada para o evento Lead do pixel" },
};

/** Local de segmentação (chave do Meta) */
export type Local = { key: string; nome: string; tipo: "city" | "region" | "country"; raio?: number };
export type Interesse = { id: string; nome: string };

export type ConfigMeta = {
  nomeCampanha: string;   // aceita {cliente}, {objetivo}, {data} e {cidade}
  nomeConjunto: string;
  nomeAnuncio: string;    // aceita também {n} (número do criativo) e {arquivo}
  orcamentoDiario: number;
  orcamentoEm: "campanha" | "conjunto";
  idadeMin: number;
  idadeMax: number;
  generos: "todos" | "homens" | "mulheres";
  advantage: boolean;     // público Advantage+ (o Meta pode ampliar além dos interesses)
  locais: Local[];        // padrão do modelo; na montagem dá para trocar (cidade do cliente)
  interesses: Interesse[];
  textos: string[];       // texto principal (até 5 variações)
  titulos: string[];      // título (até 5 variações)
  descricao: string;
  cta: string;
  url: string;            // site (objetivo site)
  utm: boolean;           // acrescenta UTMs padrão no link do site
  mensagemWhatsapp: string;
};

export type Modelo = {
  id: string;
  nome: string;
  plataforma: "meta" | "google";
  objetivo: ObjetivoMeta;
  config: ConfigMeta;
};

/** Botões de ação aceitos por objetivo */
export const CTAS: Record<ObjetivoMeta, { valor: string; rotulo: string }[]> = {
  formulario: [
    { valor: "SIGN_UP", rotulo: "Cadastre-se" },
    { valor: "LEARN_MORE", rotulo: "Saiba mais" },
    { valor: "GET_QUOTE", rotulo: "Solicitar orçamento" },
    { valor: "APPLY_NOW", rotulo: "Inscreva-se já" },
    { valor: "CONTACT_US", rotulo: "Fale conosco" },
  ],
  mensagens: [{ valor: "WHATSAPP_MESSAGE", rotulo: "Enviar mensagem pelo WhatsApp" }],
  site: [
    { valor: "LEARN_MORE", rotulo: "Saiba mais" },
    { valor: "SIGN_UP", rotulo: "Cadastre-se" },
    { valor: "GET_QUOTE", rotulo: "Solicitar orçamento" },
    { valor: "CONTACT_US", rotulo: "Fale conosco" },
    { valor: "SHOP_NOW", rotulo: "Comprar agora" },
  ],
};

const BASE: ConfigMeta = {
  nomeCampanha: "[{objetivo}] {cliente} - {data}",
  nomeConjunto: "{cidade} - {objetivo}",
  nomeAnuncio: "AD {n} - {arquivo}",
  orcamentoDiario: 30,
  orcamentoEm: "conjunto",
  idadeMin: 25,
  idadeMax: 65,
  generos: "todos",
  advantage: true,
  locais: [],
  interesses: [],
  textos: [""],
  titulos: [""],
  descricao: "",
  cta: "LEARN_MORE",
  url: "",
  utm: true,
  mensagemWhatsapp: "",
};

/** Modelos prontos para começar (o usuário edita e salva os dele). */
export const MODELOS_PADRAO: { nome: string; objetivo: ObjetivoMeta; config: ConfigMeta }[] = [
  {
    nome: "Formulário de cadastro",
    objetivo: "formulario",
    config: {
      ...BASE, cta: "SIGN_UP",
      textos: ["Preencha o formulário e receba um orçamento sem compromisso."],
      titulos: ["Solicite seu orçamento"],
    },
  },
  {
    nome: "Mensagens no WhatsApp",
    objetivo: "mensagens",
    config: {
      ...BASE, cta: "WHATSAPP_MESSAGE",
      textos: ["Chame a gente no WhatsApp e tire suas dúvidas."],
      titulos: ["Fale com a gente no WhatsApp"],
      mensagemWhatsapp: "Olá! Vi o anúncio e quero mais informações.",
    },
  },
  {
    nome: "Leads no site",
    objetivo: "site",
    config: {
      ...BASE, cta: "LEARN_MORE",
      textos: ["Conheça e solicite seu orçamento pelo site."],
      titulos: ["Saiba mais"],
    },
  },
];

export const ROTULO_CURTO: Record<ObjetivoMeta, string> = { formulario: "CADASTRO", mensagens: "MENSAGEM", site: "SITE" };

/** Troca {cliente}, {data} etc. pelos valores da montagem. */
export function aplicarNome(padrao: string, vars: Record<string, string>) {
  return padrao.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)).replace(/\s+/g, " ").trim();
}

/** Completa uma config salva com os campos que faltarem (modelos antigos ou JSON parcial). */
export function normalizarConfig(c: Partial<ConfigMeta> | null | undefined): ConfigMeta {
  return { ...BASE, ...(c ?? {}) };
}
