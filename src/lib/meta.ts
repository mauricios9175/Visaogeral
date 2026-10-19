import "server-only";

const VERSAO = process.env.META_API_VERSION ?? "v23.0";
const BASE = `https://graph.facebook.com/${VERSAO}`;

export class MetaErro extends Error {
  constructor(message: string, public codigo?: number) {
    super(message);
  }
}

type Pagina<T> = { data: T[]; paging?: { next?: string } };

async function get<T>(url: string, tentativa = 0): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const corpo = await res.json();
  if (corpo.error) {
    const codigo: number = corpo.error.code;
    // 4/17/32/613/80004 = limite de chamadas: espera e tenta de novo
    if ([4, 17, 32, 613, 80004].includes(codigo) && tentativa < 4) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** tentativa));
      return get<T>(url, tentativa + 1);
    }
    throw new MetaErro(corpo.error.message, codigo);
  }
  return corpo as T;
}

async function todasPaginas<T>(url: string): Promise<T[]> {
  const itens: T[] = [];
  let proxima: string | undefined = url;
  while (proxima) {
    const pagina: Pagina<T> = await get<Pagina<T>>(proxima);
    itens.push(...pagina.data);
    proxima = pagina.paging?.next;
  }
  return itens;
}

function montarUrl(caminho: string, token: string, params: Record<string, string> = {}) {
  const u = new URL(`${BASE}/${caminho}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("access_token", token);
  return u.toString();
}

export type ContaMeta = {
  id: string;
  name: string;
  currency: string;
  timezone_name: string;
  account_status: number;
  business?: { name: string };
  is_prepay_account?: boolean;
  amount_spent?: string;   // em centavos
  spend_cap?: string;      // em centavos; "0" = sem limite
  funding_source_details?: { display_string?: string };
};

export function listarContas(token: string) {
  return todasPaginas<ContaMeta>(
    montarUrl("me/adaccounts", token, {
      fields: [
        "id", "name", "currency", "timezone_name", "account_status", "business{name}",
        "is_prepay_account", "amount_spent", "spend_cap", "funding_source_details",
      ].join(","),
      limit: "200",
    }),
  );
}

/**
 * O Meta só informa o saldo pré-pago como texto, ex.: "Saldo disponível (R$ 1.234,56 BRL)"
 * ou "Available balance (R$1,234.56 BRL)". Extrai o número nos dois formatos.
 */
export function lerSaldo(texto: string | undefined): number | null {
  if (!texto || !/saldo|balance/i.test(texto)) return null;
  const numeros = texto.match(/\d[\d.,]*/g);
  if (!numeros) return null;
  const bruto = numeros[numeros.length - 1];
  const decimalVirgula = /,\d{1,2}$/.test(bruto);
  const limpo = decimalVirgula ? bruto.replace(/\./g, "").replace(",", ".") : bruto.replace(/,/g, "");
  const valor = Number(limpo);
  return Number.isFinite(valor) ? valor : null;
}

/** Campos de saldo/limite prontos para salvar em contas_anuncio. */
export function dadosFinanceiros(c: ContaMeta) {
  const texto = c.funding_source_details?.display_string ?? null;
  const cap = Number(c.spend_cap ?? 0) / 100;
  return {
    pre_paga: c.is_prepay_account ?? null,
    saldo: c.is_prepay_account ? lerSaldo(texto ?? undefined) : null,
    saldo_texto: texto,
    limite_gasto: cap > 0 ? cap : null,
    total_gasto: c.amount_spent != null ? Number(c.amount_spent) / 100 : null,
    saldo_em: new Date().toISOString(),
  };
}

export function quemSou(token: string) {
  return get<{ id: string; name: string }>(montarUrl("me", token, { fields: "id,name" }));
}

type Acao = { action_type: string; value: string };

export type LinhaInsight = {
  date_start: string;
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  ad_id: string;
  ad_name: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  inline_link_clicks?: string;
  actions?: Acao[];
  action_values?: Acao[];
  // "Resultados" exatamente como o Gerenciador de Anúncios mostra (segue o objetivo do conjunto)
  results?: { indicator?: string; values?: { value?: string }[] }[];
  optimization_goal?: string;
};

const CAMPOS_INSIGHTS = [
  "campaign_id", "campaign_name", "adset_id", "adset_name", "ad_id", "ad_name",
  "spend", "impressions", "reach", "clicks", "inline_link_clicks",
  "actions", "action_values",
];
// Campos que nem toda versão/conta aceita; se o Meta recusar, seguimos sem eles.
const CAMPOS_EXTRAS = ["results", "optimization_goal"];
let aceitaExtras = true;

/** Métricas por anúncio e por dia, num intervalo de datas (formato AAAA-MM-DD). */
export async function insightsPorAnuncio(contaId: string, token: string, desde: string, ate: string) {
  const buscar = (campos: string[]) =>
    todasPaginas<LinhaInsight>(
      montarUrl(`${contaId}/insights`, token, {
        level: "ad",
        time_increment: "1",
        time_range: JSON.stringify({ since: desde, until: ate }),
        fields: campos.join(","),
        limit: "500",
      }),
    );
  if (!aceitaExtras) return buscar(CAMPOS_INSIGHTS);
  try {
    return await buscar([...CAMPOS_INSIGHTS, ...CAMPOS_EXTRAS]);
  } catch (e) {
    if (e instanceof MetaErro && e.codigo === 100) {
      aceitaExtras = false;
      return buscar(CAMPOS_INSIGHTS);
    }
    throw e;
  }
}

/** Insights por campanha com os dados brutos, para a tela de diagnóstico. */
export function insightsDiagnostico(contaId: string, token: string, desde: string, ate: string) {
  return todasPaginas<LinhaInsight & { objective?: string; optimization_goal?: string }>(
    montarUrl(`${contaId}/insights`, token, {
      level: "adset",
      time_range: JSON.stringify({ since: desde, until: ate }),
      fields: ["campaign_name", "adset_id", "adset_name", "objective", "optimization_goal", "spend", "actions", "results"].join(","),
      limit: "200",
    }),
  );
}

export type ObjetivoConjunto = {
  id: string;
  effective_status?: string;
  optimization_goal?: string;
  promoted_object?: { custom_event_type?: string; custom_conversion_id?: string; custom_event_str?: string };
};

/** Objetivo de otimização de cada conjunto da conta (inclui pausados e arquivados). */
export async function objetivosDosConjuntos(contaId: string, token: string) {
  const conjuntos = await todasPaginas<ObjetivoConjunto>(
    montarUrl(`${contaId}/adsets`, token, {
      fields: "id,effective_status,optimization_goal,promoted_object",
      limit: "500",
    }),
  );
  return new Map(conjuntos.map((c) => [c.id, c]));
}

/** Status atual (effective_status) de todas as campanhas ou anúncios da conta. */
export function listarStatus(contaId: string, token: string, nivel: "campaigns" | "ads") {
  return todasPaginas<{ id: string; effective_status: string }>(
    montarUrl(`${contaId}/${nivel}`, token, { fields: "id,effective_status", limit: "500" }),
  );
}

function valor(acoes: Acao[] | undefined, tipo: string): number | undefined {
  const a = acoes?.find((x) => x.action_type === tipo);
  return a ? Number(a.value) : undefined;
}

/** Tipos de resultado que o painel separa. "outros" = cliques, engajamento, alcance etc. */
export const TIPOS_RESULTADO = [
  "conversas", "formulario", "lead_site", "conv_personalizada", "compras", "cadastro", "outros",
] as const;
export type TipoResultado = (typeof TIPOS_RESULTADO)[number];

/**
 * Classifica um action_type / indicador do Meta num tipo de resultado do painel.
 * Aceita "actions:lead", "conversions:contact_website", "offsite_conversion.custom.123" etc.
 */
export function classificarAcao(acao: string, actions?: Acao[]): TipoResultado {
  const [fonte, a] = acao.includes(":") ? (acao.split(":", 2) as [string, string]) : ["actions", acao];
  if (/messaging_conversation_started|messaging_first_reply|total_messaging_connection/.test(a)) return "conversas";
  if (/lead_grouped|leadgen|^onsite_conversion\.lead/.test(a)) return "formulario";
  if (a === "lead") return (valor(actions, "onsite_conversion.lead_grouped") ?? 0) > 0 ? "formulario" : "lead_site";
  if (/fb_pixel_lead|offsite_conversion\.lead|^offline_conversion\.lead|^lead_website|^lead_offline/.test(a)) return "lead_site";
  if (/purchase/.test(a)) return "compras";
  if (/complete_registration/.test(a)) return "cadastro";
  if (/offsite_conversion\.custom\.|fb_pixel_custom|^offsite_conversion\.fb_pixel_/.test(a)) return "conv_personalizada";
  // Eventos padrão do pixel no campo "conversions": contato, agendamento, inscrição, etc.
  if (/^(contact|schedule|submit_application|find_location|customize_product|donate|subscribe|start_trial|add_to_cart|initiate_checkout|add_payment_info|add_to_wishlist|search|view_content)/.test(a)) {
    return "conv_personalizada";
  }
  // Qualquer outra coisa vinda do campo "conversions" é conversão; de "actions" é clique/engajamento.
  return fonte === "conversions" ? "conv_personalizada" : "outros";
}

/** Qual action_type conta como resultado para um conjunto, a partir do objetivo dele. */
function acaoDoObjetivo(c: ObjetivoConjunto | undefined): string | null {
  if (!c?.optimization_goal) return null;
  const po = c.promoted_object ?? {};
  switch (c.optimization_goal) {
    case "CONVERSATIONS":
    case "REPLIES":
      return "onsite_conversion.messaging_conversation_started_7d";
    case "LEAD_GENERATION":
    case "QUALITY_LEAD":
      return "onsite_conversion.lead_grouped";
    case "OFFSITE_CONVERSIONS":
    case "VALUE":
      if (po.custom_conversion_id) return `offsite_conversion.custom.${po.custom_conversion_id}`;
      if (po.custom_event_type === "LEAD") return "offsite_conversion.fb_pixel_lead";
      if (po.custom_event_type === "PURCHASE") return "omni_purchase";
      if (po.custom_event_type === "COMPLETE_REGISTRATION") return "offsite_conversion.fb_pixel_complete_registration";
      if (po.custom_event_type === "OTHER" || po.custom_event_str) return "offsite_conversion.fb_pixel_custom";
      if (po.custom_event_type) return `offsite_conversion.fb_pixel_${po.custom_event_type.toLowerCase()}`;
      return null;
    case "LINK_CLICKS":
      return "link_click";
    case "LANDING_PAGE_VIEWS":
      return "landing_page_view";
    case "THRUPLAY":
      return "video_thruplay_watched_actions";
    case "POST_ENGAGEMENT":
      return "post_engagement";
    default:
      return null;
  }
}

/** Converte a linha do Meta nos números que o painel usa, incluindo o "Resultado" do Gerenciador. */
export function extrairResultados(linha: LinhaInsight, conjuntos?: Map<string, ObjetivoConjunto>) {
  const { actions, action_values } = linha;
  // "lead" já soma formulário nativo + pixel; os outros são fallback pra contas antigas.
  const leads =
    valor(actions, "lead") ??
    (valor(actions, "onsite_conversion.lead_grouped") ?? 0) +
      (valor(actions, "offsite_conversion.fb_pixel_lead") ?? 0);
  const conversas = valor(actions, "onsite_conversion.messaging_conversation_started_7d") ?? 0;
  const compras = valor(actions, "omni_purchase") ?? valor(actions, "purchase") ?? 0;
  const valorCompras = valor(action_values, "omni_purchase") ?? valor(action_values, "purchase") ?? 0;

  // 1º: o campo "results" do próprio Meta. 2º: o objetivo do conjunto. 3º: conversas/leads.
  let acao: string | null = null;
  let quantidade = 0;
  const r = linha.results?.find((x) => x.indicator);
  if (r?.indicator) {
    acao = r.indicator.startsWith("actions:") ? r.indicator.slice("actions:".length) : r.indicator;
    quantidade = Number(r.values?.[0]?.value ?? 0);
  } else {
    acao = acaoDoObjetivo(
      conjuntos?.get(linha.adset_id) ??
        (linha.optimization_goal ? { id: linha.adset_id, optimization_goal: linha.optimization_goal } : undefined),
    );
    if (acao) {
      quantidade =
        acao === "omni_purchase" ? compras
        : acao === "offsite_conversion.fb_pixel_custom"
          ? (valor(actions, acao) ?? (actions ?? [])
              .filter((x) => x.action_type.startsWith("offsite_conversion.custom."))
              .reduce((s, x) => s + Number(x.value), 0))
          : (valor(actions, acao) ?? (acao === "onsite_conversion.lead_grouped" ? valor(actions, "lead") ?? 0 : 0));
    } else if (conversas > 0) {
      acao = "onsite_conversion.messaging_conversation_started_7d";
      quantidade = conversas;
    } else if (leads > 0) {
      acao = "lead";
      quantidade = leads;
    }
    // Sem objetivo identificado (ou evento personalizado genérico): usa a conversão personalizada que aparecer.
    if (quantidade === 0 && (!acao || acao === "offsite_conversion.fb_pixel_custom")) {
      const custom = (actions ?? []).filter(
        (x) => x.action_type.startsWith("offsite_conversion.custom.") || x.action_type === "offsite_conversion.fb_pixel_custom",
      );
      if (custom.length) {
        const maior = custom.reduce((a, b) => (Number(b.value) > Number(a.value) ? b : a));
        acao = maior.action_type;
        quantidade = Number(maior.value);
      }
    }
  }
  const tipo: TipoResultado = acao ? classificarAcao(acao, actions) : "outros";
  return { leads, conversas, compras, valorCompras, resultados: quantidade, tipo, acao };
}

// ---------- Login com Facebook (contas que ficam no BM do cliente) ----------

export const ESCOPOS_LOGIN = "ads_read,leads_retrieval,business_management";

export function urlLogin(redirectUri: string, state: string) {
  const u = new URL(`https://www.facebook.com/${VERSAO}/dialog/oauth`);
  u.searchParams.set("client_id", process.env.META_APP_ID ?? "");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  // Apps do tipo Empresa usam "Login do Facebook para Empresas", que exige um config_id;
  // sem ele, cai no login clássico com a lista de permissões.
  const configId = process.env.META_LOGIN_CONFIG_ID;
  if (configId) u.searchParams.set("config_id", configId);
  else u.searchParams.set("scope", ESCOPOS_LOGIN);
  return u.toString();
}

type RespostaToken = { access_token: string; expires_in?: number };

export async function trocarCodigoPorTokenLongo(code: string, redirectUri: string) {
  const app = { client_id: process.env.META_APP_ID ?? "", client_secret: process.env.META_APP_SECRET ?? "" };
  const curto = await get<RespostaToken>(
    `${BASE}/oauth/access_token?` + new URLSearchParams({ ...app, redirect_uri: redirectUri, code }),
  );
  const longo = await get<RespostaToken>(
    `${BASE}/oauth/access_token?` +
      new URLSearchParams({ ...app, grant_type: "fb_exchange_token", fb_exchange_token: curto.access_token }),
  );
  return {
    token: longo.access_token,
    expiraEm: longo.expires_in ? new Date(Date.now() + longo.expires_in * 1000) : null,
  };
}
