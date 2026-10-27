import "server-only";

// v24 e anteriores deixaram de funcionar em out/2026
const VERSAO = process.env.META_API_VERSION ?? "v25.0";
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
  // vídeo (para o painel de criativos)
  video_play_actions?: Acao[];
  video_p25_watched_actions?: Acao[];
  video_p50_watched_actions?: Acao[];
  video_p75_watched_actions?: Acao[];
  video_p100_watched_actions?: Acao[];
  video_thruplay_watched_actions?: Acao[];
};

const CAMPOS_INSIGHTS = [
  "campaign_id", "campaign_name", "adset_id", "adset_name", "ad_id", "ad_name",
  "spend", "impressions", "reach", "clicks", "inline_link_clicks",
  "actions", "action_values",
];
// Campos que nem toda versão/conta aceita; se o Meta recusar, seguimos sem eles.
const CAMPOS_EXTRAS = ["results", "optimization_goal"];
let aceitaExtras = true;
const CAMPOS_VIDEO = [
  "video_play_actions", "video_p25_watched_actions", "video_p50_watched_actions",
  "video_p75_watched_actions", "video_p100_watched_actions", "video_thruplay_watched_actions",
];
let aceitaVideo = true;

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
  // Tenta com tudo; se o Meta recusar algum campo (código 100), tira primeiro os de vídeo, depois os extras.
  for (;;) {
    const campos = [...CAMPOS_INSIGHTS, ...(aceitaExtras ? CAMPOS_EXTRAS : []), ...(aceitaVideo ? CAMPOS_VIDEO : [])];
    try {
      return await buscar(campos);
    } catch (e) {
      if (!(e instanceof MetaErro && e.codigo === 100)) throw e;
      if (aceitaVideo) aceitaVideo = false;
      else if (aceitaExtras) aceitaExtras = false;
      else throw e;
    }
  }
}

/** Soma os valores de uma lista de ações do Meta (ex.: video_p25_watched_actions). */
export function somaAcoes(lista?: Acao[], tipo?: string) {
  return (lista ?? []).filter((a) => !tipo || a.action_type === tipo).reduce((s, a) => s + Number(a.value ?? 0), 0);
}

/** Métricas de vídeo da linha: plays, 3 segundos (gancho), quartis e ThruPlay. */
export function metricasVideo(l: LinhaInsight) {
  return {
    video_plays: somaAcoes(l.video_play_actions),
    video_3s: somaAcoes(l.actions, "video_view"),
    video_p25: somaAcoes(l.video_p25_watched_actions),
    video_p50: somaAcoes(l.video_p50_watched_actions),
    video_p75: somaAcoes(l.video_p75_watched_actions),
    video_p100: somaAcoes(l.video_p100_watched_actions),
    video_thruplay: somaAcoes(l.video_thruplay_watched_actions),
  };
}

/** Criativo do anúncio, como vem do Graph (campo creative do anúncio). */
export type CriativoMeta = {
  id: string;
  effective_status?: string;
  creative?: {
    object_type?: string;
    thumbnail_url?: string;
    image_url?: string;
    video_id?: string;
    title?: string;
    body?: string;
    instagram_permalink_url?: string;
    effective_object_story_id?: string;
  };
};

// thumbnail maior que o padrão (64x64); se o Meta não aceitar o modificador, usamos o campo simples
const CRIATIVO_GRANDE = "id,effective_status,creative.thumbnail_width(480).thumbnail_height(480){object_type,thumbnail_url,image_url,video_id,title,body,instagram_permalink_url,effective_object_story_id}";
const CRIATIVO_SIMPLES = "id,effective_status,creative{object_type,thumbnail_url,image_url,video_id,title,body,instagram_permalink_url,effective_object_story_id}";

/** Status e criativo dos anúncios (pelos ids, 50 por chamada). */
let camposCriativo: string | null = null;
export async function criativosDosAnuncios(ids: string[], token: string) {
  const unicos = [...new Set(ids.filter(Boolean))];
  if (!unicos.length) return new Map<string, CriativoMeta>();
  // buscarPorIds engole erros por item; então testamos o modificador uma vez com um anúncio só
  if (!camposCriativo) {
    try {
      await get(montarUrl(unicos[0], token, { fields: CRIATIVO_GRANDE }));
      camposCriativo = CRIATIVO_GRANDE;
    } catch (e) {
      if (e instanceof MetaErro && e.codigo === 100) camposCriativo = CRIATIVO_SIMPLES;
      else return buscarPorIds<CriativoMeta>(unicos, token, CRIATIVO_SIMPLES);
    }
  }
  return buscarPorIds<CriativoMeta>(unicos, token, camposCriativo);
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

/**
 * Lê vários objetos (campanhas, conjuntos, anúncios) de uma vez pelo id, 50 por chamada.
 * Bem mais leve que listar tudo da conta, que inclui anos de itens arquivados.
 */
export async function buscarPorIds<T>(ids: string[], token: string, campos: string): Promise<Map<string, T>> {
  const mapa = new Map<string, T>();
  const unicos = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unicos.length; i += 50) {
    const lote = unicos.slice(i, i + 50);
    try {
      const r = await get<Record<string, T>>(montarUrl("", token, { ids: lote.join(","), fields: campos }));
      for (const [id, obj] of Object.entries(r)) mapa.set(id, obj);
    } catch {
      // Um item excluído derruba o lote inteiro; nesse caso busca um por um e pula os que falharem.
      for (const id of lote) {
        const obj = await get<T>(montarUrl(id, token, { fields: campos })).catch(() => null);
        if (obj) mapa.set(id, obj);
      }
    }
  }
  return mapa;
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

// ads_management: necessário para as ações rápidas (pausar, ativar, mudar orçamento)
// pages_*: listar páginas e formulários na montagem de campanhas
export const ESCOPOS_LOGIN = "ads_read,ads_management,leads_retrieval,business_management,pages_show_list,pages_manage_ads,pages_read_engagement";

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

/** Alcance real da conta no período (o alcance somado por anúncio/dia conta a mesma pessoa várias vezes). */
export async function alcanceDaConta(contaId: string, token: string, desde: string, ate: string) {
  const r = await get<Pagina<{ reach?: string }>>(
    montarUrl(`${contaId}/insights`, token, {
      level: "account",
      fields: "reach",
      time_range: JSON.stringify({ since: desde, until: ate }),
    }),
  );
  return Number(r.data[0]?.reach ?? 0);
}

/** Link do criativo de um anúncio: post do Instagram, se houver; senão o post do Facebook. */
export async function linkDoCriativo(adId: string, token: string): Promise<string | null> {
  const r = await get<{ creative?: { instagram_permalink_url?: string; effective_object_story_id?: string } }>(
    montarUrl(adId, token, { fields: "creative{instagram_permalink_url,effective_object_story_id}" }),
  ).catch(() => null);
  const c = r?.creative;
  if (c?.instagram_permalink_url) return c.instagram_permalink_url;
  if (c?.effective_object_story_id) return `https://www.facebook.com/${c.effective_object_story_id}`;
  return null;
}

// ---------- Ações rápidas (escrita) ----------

/** Mensagem clara quando falta a permissão de gerenciar anúncios. */
function erroDeEscrita(e: unknown): Error {
  if (e instanceof MetaErro && [10, 200, 3, 294].includes(e.codigo ?? -1)) {
    return new Error(
      "Sem permissão para alterar anúncios. Adicione “ads_management” na configuração do Login do app no Meta e clique em “Conectar / reconectar perfil” em Configurações.",
    );
  }
  if (e instanceof Error && /modo de desenvolvimento|development mode|in development/i.test(e.message)) {
    return new Error(
      "O app do Meta usado pelo painel está em modo de desenvolvimento, e o Meta só aceita anúncios criados por app em modo público. " +
      "Em developers.facebook.com → seu app, mude o “Modo do app” para “Ao vivo” (publicar). Depois é só montar de novo.",
    );
  }
  return e instanceof Error ? e : new Error(String(e));
}

async function post(id: string, token: string, campos: Record<string, string>) {
  const res = await fetch(`${BASE}/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...campos, access_token: token }),
    cache: "no-store",
  });
  const corpo = await res.json();
  if (corpo.error) throw erroDeEscrita(new MetaErro(corpo.error.error_user_msg || corpo.error.message, corpo.error.code));
  return corpo;
}

/** Pausa ou ativa campanha, conjunto ou anúncio. */
export async function mudarStatus(id: string, token: string, ativo: boolean) {
  await post(id, token, { status: ativo ? "ACTIVE" : "PAUSED" });
}

export type Orcamento = { id: string; nome: string; nivel: "campanha" | "conjunto"; diario: number | null; total: number | null };

/**
 * Onde está o orçamento de um conjunto: no próprio conjunto ou na campanha (orçamento de campanha / CBO).
 * Valores em reais (o Meta trabalha em centavos).
 */
export async function orcamentoDe(id: string, token: string, nivel: "campanha" | "conjunto"): Promise<Orcamento | null> {
  type Obj = { id: string; name?: string; daily_budget?: string; lifetime_budget?: string; campaign?: Obj };
  const campos = nivel === "conjunto"
    ? "id,name,daily_budget,lifetime_budget,campaign{id,name,daily_budget,lifetime_budget}"
    : "id,name,daily_budget,lifetime_budget";
  const o = await get<Obj>(montarUrl(id, token, { fields: campos }));
  const ler = (x: Obj, n: Orcamento["nivel"]): Orcamento | null => {
    const diario = Number(x.daily_budget ?? 0) / 100, total = Number(x.lifetime_budget ?? 0) / 100;
    return diario || total ? { id: x.id, nome: x.name ?? x.id, nivel: n, diario: diario || null, total: total || null } : null;
  };
  return ler(o, nivel) ?? (o.campaign ? ler(o.campaign, "campanha") : null);
}

/** Muda o orçamento (diário ou total, o que o item usar). Valor em reais. */
export async function mudarOrcamento(o: Orcamento, token: string, novo: number) {
  const centavos = String(Math.round(novo * 100));
  await post(o.id, token, o.diario != null ? { daily_budget: centavos } : { lifetime_budget: centavos });
}

// ---------- Duplicar (cópias do próprio Meta; tudo nasce PAUSADO) ----------

const COPIA = JSON.stringify({ rename_strategy: "ONLY_TOP_LEVEL_RENAME", rename_suffix: " - cópia" });
const SEM_RENOMEAR = JSON.stringify({ rename_strategy: "NO_RENAME" });

/** Lista os ids filhos (conjuntos de uma campanha ou anúncios de um conjunto), sem os excluídos. */
async function filhos(id: string, token: string, borda: "adsets" | "ads") {
  return (await todasPaginas<{ id: string }>(montarUrl(`${id}/${borda}`, token, { fields: "id", limit: "200" }))).map((x) => x.id);
}

/** Duplica um anúncio para um conjunto (o mesmo ou outro da mesma conta). */
export async function duplicarAnuncio(adId: string, token: string, conjuntoDestino: string, renomear = true) {
  const r = await post(`${adId}/copies`, token, {
    adset_id: conjuntoDestino, status_option: "PAUSED", rename_options: renomear ? COPIA : SEM_RENOMEAR,
  });
  return String(r.copied_ad_id ?? r.ad_object_ids?.[0]?.copied_id ?? "");
}

/**
 * Duplica um conjunto (com ou sem os anúncios) para uma campanha.
 * O Meta só faz a cópia completa de uma vez quando há poucos anúncios; se recusar, copia o conjunto e depois anúncio por anúncio.
 */
export async function duplicarConjunto(adsetId: string, token: string, campanhaDestino: string, comAnuncios: boolean) {
  const base = { campaign_id: campanhaDestino, status_option: "PAUSED" };
  if (comAnuncios) {
    try {
      const r = await post(`${adsetId}/copies`, token, { ...base, deep_copy: "true", rename_options: COPIA });
      return { id: String(r.copied_adset_id), anuncios: (r.ad_object_ids ?? []).length as number };
    } catch {
      // segue para a cópia em partes
    }
  }
  const r = await post(`${adsetId}/copies`, token, { ...base, deep_copy: "false", rename_options: COPIA });
  const novo = String(r.copied_adset_id);
  let anuncios = 0;
  if (comAnuncios) {
    for (const ad of await filhos(adsetId, token, "ads")) {
      await duplicarAnuncio(ad, token, novo, false);
      anuncios++;
    }
  }
  return { id: novo, anuncios };
}

/** Duplica uma campanha inteira (conjuntos e anúncios). */
export async function duplicarCampanha(campanhaId: string, token: string) {
  try {
    const r = await post(`${campanhaId}/copies`, token, { deep_copy: "true", status_option: "PAUSED", rename_options: COPIA });
    return String(r.copied_campaign_id);
  } catch {
    const r = await post(`${campanhaId}/copies`, token, { deep_copy: "false", status_option: "PAUSED", rename_options: COPIA });
    const nova = String(r.copied_campaign_id);
    for (const adset of await filhos(campanhaId, token, "adsets")) {
      // conjuntos e anúncios copiados sem " - cópia" (só a campanha recebe o sufixo)
      const c = await post(`${adset}/copies`, token, { campaign_id: nova, deep_copy: "false", status_option: "PAUSED", rename_options: SEM_RENOMEAR });
      for (const ad of await filhos(adset, token, "ads")) await duplicarAnuncio(ad, token, String(c.copied_adset_id), false);
    }
    return nova;
  }
}

/** Link para o item no Gerenciador de Anúncios (para revisar a cópia antes de ativar). */
export function linkGerenciador(contaId: string, nivel: "campanha" | "conjunto" | "anuncio", id: string) {
  const act = contaId.replace(/^act_/, "");
  const [aba, campo] = nivel === "campanha" ? ["campaigns", "selected_campaign_ids"] : nivel === "conjunto" ? ["adsets", "selected_adset_ids"] : ["ads", "selected_ad_ids"];
  return `https://adsmanager.facebook.com/adsmanager/manage/${aba}?act=${act}&${campo}=${id}`;
}

// usados pela montagem de campanhas (meta-montar.ts)
export { get as getMeta, post as postMeta, montarUrl, todasPaginas, BASE as BASE_META };
