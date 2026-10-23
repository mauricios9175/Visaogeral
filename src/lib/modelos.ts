// Modelos de campanha do Meta. Arquivo sem "server-only": os tipos e padrões também são usados nos formulários.

export type ObjetivoMeta = "formulario" | "mensagens" | "site";

export const OBJETIVOS: Record<ObjetivoMeta, { rotulo: string; descricao: string }> = {
  formulario: { rotulo: "Formulário (cadastro)", descricao: "Campanha de Leads com formulário instantâneo do Meta" },
  mensagens: { rotulo: "Mensagens no WhatsApp", descricao: "Campanha de Engajamento com destino WhatsApp" },
  site: { rotulo: "Leads no site", descricao: "Campanha de Leads otimizada para o evento Lead do pixel" },
};

/** Local de segmentação (chave do Meta) */
export type Local = { key: string; nome: string; tipo: "city" | "region" | "country"; raio?: number };
/**
 * Item de segmentação detalhada (interesse, comportamento, cargo, setor, formação, evento da vida…).
 * `tipo` é a chave usada pelo Meta no flexible_spec (interests, behaviors, work_positions…); sem tipo = interesse.
 */
export type Interesse = { id: string; nome: string; tipo?: string; caminho?: string; publico?: number };

/** Como cada tipo de segmentação aparece na tela */
export const TIPOS_SEGMENTACAO: Record<string, string> = {
  interests: "Interesse",
  behaviors: "Comportamento",
  work_positions: "Cargo",
  work_employers: "Empregador",
  industries: "Setor",
  education_schools: "Escola",
  education_majors: "Área de estudo",
  education_statuses: "Escolaridade",
  life_events: "Evento da vida",
  family_statuses: "Família",
  relationship_statuses: "Relacionamento",
  income: "Renda",
  user_adclusters: "Interesse",
};

/** Um conjunto de anúncios do modelo: cada um com o seu público. */
export type ConjuntoMeta = {
  nome: string;           // aceita {cliente}, {objetivo}, {data} e {cidade}
  orcamentoDiario: number; // usado quando o orçamento fica no conjunto (ABO)
  idadeMin: number;
  idadeMax: number;
  generos: "todos" | "homens" | "mulheres";
  advantage: boolean;     // público Advantage+ (o Meta pode ampliar além dos interesses)
  interesses: Interesse[];
};

export type ConfigMeta = {
  nomeCampanha: string;   // aceita {cliente}, {objetivo}, {data} e {cidade}
  nomeAnuncio: string;    // aceita também {n} (número do criativo), {arquivo} e {conjunto}
  orcamentoDiario: number; // usado quando o orçamento fica na campanha (CBO)
  orcamentoEm: "campanha" | "conjunto";
  locais: Local[];        // vale para todos os conjuntos; na montagem você escolhe a cidade do cliente
  conjuntos: ConjuntoMeta[];
  textos: string[];       // texto principal (até 5 variações)
  titulos: string[];      // título (até 5 variações)
  descricao: string;
  cta: string;
  url: string;            // site (objetivo site)
  utm: boolean;           // acrescenta UTMs padrão no link do site
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

export const CONJUNTO_PADRAO: ConjuntoMeta = {
  nome: "{cidade} - Aberto",
  orcamentoDiario: 30,
  idadeMin: 25,
  idadeMax: 65,
  generos: "todos",
  advantage: true,
  interesses: [],
};

const BASE: ConfigMeta = {
  nomeCampanha: "[{objetivo}] {cliente} - {data}",
  nomeAnuncio: "AD {n} - {arquivo}",
  orcamentoDiario: 30,
  orcamentoEm: "conjunto",
  locais: [],
  // exemplo com dois públicos; o usuário troca os interesses de cada nicho
  conjuntos: [CONJUNTO_PADRAO, { ...CONJUNTO_PADRAO, nome: "{cidade} - Interesses", advantage: false }],
  textos: [""],
  titulos: [""],
  descricao: "",
  cta: "LEARN_MORE",
  url: "",
  utm: true,
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

/** Campos da primeira versão dos modelos (um conjunto só, público no nível da campanha). */
type Legado = Partial<Omit<ConjuntoMeta, "nome" | "orcamentoDiario"> & { nomeConjunto: string }>;

/** Completa uma config salva com os campos que faltarem (modelos antigos ou JSON parcial). */
export function normalizarConfig(c: (Partial<ConfigMeta> & Legado) | null | undefined): ConfigMeta {
  const { nomeConjunto, idadeMin, idadeMax, generos, advantage, interesses, ...resto } = c ?? {};
  const conjuntos = resto.conjuntos?.length
    ? resto.conjuntos.map((x) => ({ ...CONJUNTO_PADRAO, ...x }))
    : [{
        ...CONJUNTO_PADRAO,
        ...(nomeConjunto && { nome: nomeConjunto }),
        ...(idadeMin != null && { idadeMin }), ...(idadeMax != null && { idadeMax }),
        ...(generos && { generos }), ...(advantage != null && { advantage }), ...(interesses && { interesses }),
        orcamentoDiario: resto.orcamentoDiario ?? CONJUNTO_PADRAO.orcamentoDiario,
      }];
  return { ...BASE, ...resto, conjuntos };
}

// ---------- Modelos de formulário instantâneo (criados na página do cliente na hora da montagem) ----------

export const OBJETIVO_FORMULARIO = "modelo_formulario"; // valor da coluna "objetivo" na tabela modelos

export type PerguntaForm = {
  tipo: "FULL_NAME" | "PHONE" | "EMAIL" | "CITY" | "STATE" | "CUSTOM";
  rotulo: string;      // só para CUSTOM
  opcoes: string[];    // CUSTOM de múltipla escolha; vazio = resposta livre
};

export type ConfigFormulario = {
  nome: string;              // aceita {cliente} e {data}
  tipo: "volume" | "intencao"; // intenção = etapa extra de revisão (leads mais qualificados)
  introTitulo: string;
  introTexto: string;
  perguntas: PerguntaForm[];
  politicaUrl: string;
  politicaTexto: string;
  agradecimentoTitulo: string;
  agradecimentoTexto: string;
  botaoTexto: string;
  botaoUrl: string;          // site ou link do WhatsApp (https://wa.me/55…)
};

export type ModeloFormulario = { id: string; nome: string; config: ConfigFormulario };

export const PERGUNTAS_PADRAO: { tipo: PerguntaForm["tipo"]; rotulo: string }[] = [
  { tipo: "FULL_NAME", rotulo: "Nome completo" },
  { tipo: "PHONE", rotulo: "Telefone" },
  { tipo: "EMAIL", rotulo: "E-mail" },
  { tipo: "CITY", rotulo: "Cidade" },
  { tipo: "STATE", rotulo: "Estado" },
];

export const FORMULARIO_PADRAO: ConfigFormulario = {
  nome: "Formulário {cliente} - {data}",
  tipo: "intencao",
  introTitulo: "",
  introTexto: "",
  perguntas: [
    { tipo: "FULL_NAME", rotulo: "", opcoes: [] },
    { tipo: "PHONE", rotulo: "", opcoes: [] },
    { tipo: "CUSTOM", rotulo: "Qual ambiente você quer planejar?", opcoes: ["Cozinha", "Quarto", "Sala", "Casa toda"] },
  ],
  politicaUrl: "",
  politicaTexto: "Política de privacidade",
  agradecimentoTitulo: "Recebemos seus dados!",
  agradecimentoTexto: "Em breve um consultor vai entrar em contato pelo WhatsApp.",
  botaoTexto: "Falar no WhatsApp",
  botaoUrl: "",
};

export function normalizarFormulario(c: Partial<ConfigFormulario> | null | undefined): ConfigFormulario {
  return { ...FORMULARIO_PADRAO, ...(c ?? {}), perguntas: c?.perguntas?.length ? c.perguntas : FORMULARIO_PADRAO.perguntas };
}
