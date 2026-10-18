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
};

/** Métricas por anúncio e por dia, num intervalo de datas (formato AAAA-MM-DD). */
export function insightsPorAnuncio(contaId: string, token: string, desde: string, ate: string) {
  return todasPaginas<LinhaInsight>(
    montarUrl(`${contaId}/insights`, token, {
      level: "ad",
      time_increment: "1",
      time_range: JSON.stringify({ since: desde, until: ate }),
      fields: [
        "campaign_id", "campaign_name", "adset_id", "adset_name", "ad_id", "ad_name",
        "spend", "impressions", "reach", "clicks", "inline_link_clicks",
        "actions", "action_values",
      ].join(","),
      limit: "500",
    }),
  );
}

function valor(acoes: Acao[] | undefined, tipo: string): number | undefined {
  const a = acoes?.find((x) => x.action_type === tipo);
  return a ? Number(a.value) : undefined;
}

/** Converte a lista de "actions" do Meta nos números que o painel usa. */
export function extrairResultados(linha: LinhaInsight) {
  const { actions, action_values } = linha;
  // "lead" já soma formulário nativo + pixel; os outros são fallback pra contas antigas.
  const leads =
    valor(actions, "lead") ??
    (valor(actions, "onsite_conversion.lead_grouped") ?? 0) +
      (valor(actions, "offsite_conversion.fb_pixel_lead") ?? 0);
  const conversas = valor(actions, "onsite_conversion.messaging_conversation_started_7d") ?? 0;
  const compras = valor(actions, "omni_purchase") ?? valor(actions, "purchase") ?? 0;
  const valorCompras = valor(action_values, "omni_purchase") ?? valor(action_values, "purchase") ?? 0;
  return { leads, conversas, compras, valorCompras };
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
