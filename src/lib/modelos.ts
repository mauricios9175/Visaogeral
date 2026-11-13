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
  /**
   * Partes da segmentação que o painel não edita, copiadas do conjunto original (exclusões de locais, públicos
   * personalizados, posicionamentos, idiomas…): vão do jeito que estavam. `geoExtra` fica dentro de geo_locations.
   */
  extras?: Record<string, unknown>;
  geoExtra?: Record<string, unknown>;
  mantidos?: string[]; // o que veio nos extras, em português (para mostrar na tela)
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
  utm: boolean;           // (antigo) acrescentava UTMs fixas no link do site; hoje vale parametrosUrl
  parametrosUrl: string;  // "Parâmetros de URL" do anúncio, com os dinâmicos do Meta ({{ad.name}}…)
  whatsapp: MensagemWhatsApp; // objetivo mensagens: o modelo de mensagem do WhatsApp
};

/**
 * Modelo de mensagem do anúncio de WhatsApp (como no Gerenciador): a saudação que a pessoa recebe e, embaixo,
 * uma mensagem pré-preenchida OU perguntas rápidas para ela tocar.
 */
export type MensagemWhatsApp = { saudacao: string; tipo: "preenchida" | "perguntas"; preenchida: string; perguntas: string[] };

export const WHATSAPP_PADRAO: MensagemWhatsApp = {
  saudacao: "Olá! Como podemos ajudar?", tipo: "preenchida", preenchida: "Olá! Gostaria de mais informações.", perguntas: [],
};

/** Mensagem do painel → page_welcome_message do Meta (JSON em texto). `base` mantém o resto do que já existia. */
export function mensagemParaMeta(m: MensagemWhatsApp, base?: Record<string, unknown> | null): string {
  const perguntas = m.perguntas.map((p) => p.trim()).filter(Boolean).slice(0, 4);
  const perguntasOk = m.tipo === "perguntas" && perguntas.length > 0;
  return JSON.stringify({
    type: "VISUAL_EDITOR", version: 2, landing_screen_type: "welcome_message", media_type: "text", user_edit: false, surface: "visual_editor_new",
    ...(base ?? {}),
    text_format: perguntasOk
      ? { customer_action_type: "ice_breakers", message: { ice_breakers: perguntas.map((title) => ({ title, response: "" })), quick_replies: [], text: m.saudacao.trim() } }
      : { customer_action_type: "autofill_message", message: { autofill_message: { content: m.preenchida.trim() || WHATSAPP_PADRAO.preenchida }, text: m.saudacao.trim() } },
  });
}

/** page_welcome_message do Meta → mensagem do painel (null se o anúncio não tem). */
export function mensagemDoMeta(bruto: unknown): MensagemWhatsApp | null {
  if (!bruto) return null;
  let j: { text_format?: { customer_action_type?: string; message?: { text?: string; autofill_message?: { content?: string }; ice_breakers?: { title?: string }[] } } };
  try {
    j = typeof bruto === "string" ? JSON.parse(bruto) : (bruto as typeof j);
  } catch {
    return null;
  }
  const m = j.text_format?.message;
  if (!m) return null;
  const perguntas = (m.ice_breakers ?? []).map((x) => x.title ?? "").filter(Boolean);
  return {
    saudacao: m.text ?? "", tipo: j.text_format?.customer_action_type === "ice_breakers" || perguntas.length ? "perguntas" : "preenchida",
    preenchida: m.autofill_message?.content ?? "", perguntas,
  };
}

/** Parâmetros de URL padrão: o Meta troca {{…}} pelos nomes reais da campanha, do conjunto e do anúncio. */
export const PARAMETROS_URL_PADRAO =
  "utm_source=facebook&utm_medium={{adset.name}}&utm_campaign={{campaign.name}}&utm_content={{ad.name}}";

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
  parametrosUrl: PARAMETROS_URL_PADRAO,
  whatsapp: WHATSAPP_PADRAO,
};

/** Campanha do zero: um conjunto aberto, sem textos nem interesses (o CTA segue o objetivo). */
export function configDoZero(objetivo: ObjetivoMeta): ConfigMeta {
  return {
    ...BASE,
    conjuntos: [{ ...CONJUNTO_PADRAO }],
    textos: [""], titulos: [""], descricao: "", url: "",
    cta: CTAS[objetivo][0].valor,
  };
}

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
  return { ...BASE, ...resto, conjuntos, whatsapp: { ...WHATSAPP_PADRAO, ...(resto.whatsapp ?? {}) } };
}

// ---------- Modelos de formulário instantâneo (criados na página do cliente na hora da montagem) ----------

export const OBJETIVO_FORMULARIO = "modelo_formulario"; // valor da coluna "objetivo" na tabela modelos

export type PerguntaForm = {
  tipo: "FULL_NAME" | "PHONE" | "EMAIL" | "CITY" | "STATE" | "ZIP" | "DOB" | "JOB_TITLE" | "COMPANY_NAME" | "CUSTOM";
  rotulo: string;      // só para CUSTOM
  opcoes: string[];    // CUSTOM de múltipla escolha; vazio = resposta livre
};

export type ConfigFormulario = {
  nome: string;              // aceita {cliente} e {data}
  tipo: "volume" | "intencao"; // intenção = etapa extra de revisão (leads mais qualificados)
  introTitulo: string;
  introTexto: string;
  tituloPerguntas: string;   // título da página de perguntas (opcional)
  perguntas: PerguntaForm[];
  politicaUrl: string;       // opcional: sem link, o formulário vai sem política personalizada
  politicaTexto: string;
  agradecimentoTitulo: string;
  agradecimentoTexto: string;
  botaoTexto: string;
  botaoUrl: string;          // site ou link do WhatsApp (https://wa.me/55…)
  idioma: string;            // idioma do formulário no Meta (PT_BR, EN_US…)
  parametros: { chave: string; valor: string }[]; // parâmetros de rastreamento do formulário (vão junto com o lead)
};

export const IDIOMAS_FORMULARIO = [
  { valor: "PT_BR", rotulo: "Português (Brasil)" },
  { valor: "ES_LA", rotulo: "Espanhol (América Latina)" },
  { valor: "EN_US", rotulo: "Inglês" },
];

export type ModeloFormulario = { id: string; nome: string; config: ConfigFormulario };

export const PERGUNTAS_PADRAO: { tipo: PerguntaForm["tipo"]; rotulo: string }[] = [
  { tipo: "FULL_NAME", rotulo: "Nome completo" },
  { tipo: "PHONE", rotulo: "Telefone" },
  { tipo: "EMAIL", rotulo: "E-mail" },
  { tipo: "CITY", rotulo: "Cidade" },
  { tipo: "STATE", rotulo: "Estado" },
  { tipo: "ZIP", rotulo: "CEP" },
  { tipo: "DOB", rotulo: "Data de nascimento" },
  { tipo: "JOB_TITLE", rotulo: "Cargo" },
  { tipo: "COMPANY_NAME", rotulo: "Empresa" },
];

export const FORMULARIO_PADRAO: ConfigFormulario = {
  nome: "Formulário {cliente} - {data}",
  tipo: "intencao",
  introTitulo: "",
  introTexto: "",
  tituloPerguntas: "",
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
  idioma: "PT_BR",
  // como no Gerenciador (Configurações do formulário → Parâmetros de rastreamento); aceita {{campaign.name}} etc.
  parametros: [
    { chave: "utm_source", valor: "Facebook" },
    { chave: "utm_medium", valor: "cpc" },
    { chave: "utm_campaign", valor: "{{campaign.name}}" },
  ],
};

export function normalizarFormulario(c: Partial<ConfigFormulario> | null | undefined): ConfigFormulario {
  return { ...FORMULARIO_PADRAO, ...(c ?? {}), perguntas: c?.perguntas?.length ? c.perguntas : FORMULARIO_PADRAO.perguntas };
}

// ---------- Locais copiados de um conjunto (raio em volta de endereço, CEPs, bairros…) ----------

/** Tipos de local do Meta que o painel não edita, mas que vêm na cópia de um conjunto (dentro de geoExtra). */
const LOCAIS_COPIADOS: Record<string, string> = {
  custom_locations: "raio em volta de endereço/ponto", zips: "CEPs", places: "lugares", neighborhoods: "bairros",
  subcities: "distritos", metros: "regiões metropolitanas", geo_markets: "mercados", electoral_districts: "distritos eleitorais",
  medium_geo_areas: "áreas", large_geo_areas: "áreas", small_geo_areas: "áreas",
};

type CustomLocation = { address_string?: string; name?: string; latitude?: number; longitude?: number; radius?: number; distance_unit?: string };

/** Descrição em português dos locais copiados de um conjunto (vazio = nenhum). */
export function locaisCopiados(c: Pick<ConjuntoMeta, "geoExtra">): string[] {
  const g = c.geoExtra ?? {};
  const saida: string[] = [];
  for (const [k, rotulo] of Object.entries(LOCAIS_COPIADOS)) {
    const v = g[k];
    if (!Array.isArray(v) || !v.length) continue;
    if (k === "custom_locations") {
      for (const p of v as CustomLocation[]) {
        const onde = p.address_string || p.name || (p.latitude != null ? `${p.latitude.toFixed(4)}, ${p.longitude?.toFixed(4)}` : "ponto no mapa");
        const raio = p.radius ? ` (raio de ${p.radius} ${p.distance_unit === "mile" ? "mi" : "km"})` : "";
        saida.push(`${onde}${raio}`);
      }
    } else {
      saida.push(`${rotulo}: ${v.length}`);
    }
  }
  return saida;
}

/** Algum conjunto tem locais copiados do original (então a montagem não precisa de cidade escolhida)? */
export function temLocaisCopiados(conjuntos: Pick<ConjuntoMeta, "geoExtra">[]) {
  return conjuntos.some((c) => locaisCopiados(c).length > 0);
}
