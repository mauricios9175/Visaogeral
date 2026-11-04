import "server-only";

/**
 * Google Ads API (REST): leitura, ações rápidas e relatórios no Google Slides.
 * Desde set/2026 o token de desenvolvedor não é mais exigido: o nível de acesso fica no projeto do Google Cloud
 * dono do GOOGLE_CLIENT_ID. Se GOOGLE_ADS_DEVELOPER_TOKEN existir, ele ainda é enviado (é ignorado pela API).
 */
const VERSAO = process.env.GOOGLE_ADS_API_VERSION?.trim() || "v25";
const BASE = `https://googleads.googleapis.com/${VERSAO}`;
// drive.file: só os arquivos que o próprio painel cria (modelo e relatórios no Google Slides), nada mais do Drive
const ESCOPOS = "https://www.googleapis.com/auth/adwords https://www.googleapis.com/auth/drive.file openid email";

function credenciais() {
  const id = process.env.GOOGLE_CLIENT_ID?.trim();
  const segredo = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!id || !segredo) throw new Error("Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET na Vercel.");
  return { id, segredo };
}

export const googleConfigurado = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export function urlLoginGoogle(redirect: string, state: string) {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({
    client_id: credenciais().id,
    redirect_uri: redirect,
    response_type: "code",
    scope: ESCOPOS,
    access_type: "offline",
    prompt: "consent", // garante que o Google devolva o refresh token
    include_granted_scopes: "true",
    state,
  }).toString();
  return u.toString();
}

async function token(params: Record<string, string>) {
  const { id, segredo } = credenciais();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: segredo, ...params }),
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok) {
    const msg = json.error_description || json.error || res.statusText;
    if (json.error === "invalid_grant") throw new Error("Login com Google expirou ou foi revogado. Reconecte em Configurações.");
    throw new Error(`Google OAuth: ${msg}`);
  }
  return json as { access_token: string; refresh_token?: string; id_token?: string; expires_in: number };
}

/** Troca o código do login pelo refresh token e descobre o e-mail da conta Google. */
export async function trocarCodigoGoogle(code: string, redirect: string) {
  const t = await token({ code, grant_type: "authorization_code", redirect_uri: redirect });
  if (!t.refresh_token) throw new Error("O Google não devolveu o refresh token. Tente conectar de novo.");
  // id_token veio direto do Google por HTTPS; só lemos o e-mail dele
  const payload = t.id_token ? JSON.parse(Buffer.from(t.id_token.split(".")[1], "base64url").toString()) : {};
  return { refreshToken: t.refresh_token, email: String(payload.email ?? "conta Google") };
}

/**
 * Token só com permissão de arquivos do painel (drive.file), para o seletor de pastas do Google no navegador.
 * Vale 1 hora e não dá acesso ao Google Ads.
 */
export async function tokenSoDrive(refreshToken: string) {
  const t = await token({ refresh_token: refreshToken, grant_type: "refresh_token", scope: "https://www.googleapis.com/auth/drive.file" });
  return t.access_token;
}

const cacheAcesso = new Map<string, { token: string; expira: number }>();

export async function tokenDeAcesso(refreshToken: string) {
  const c = cacheAcesso.get(refreshToken);
  if (c && c.expira > Date.now() + 60_000) return c.token;
  const t = await token({ refresh_token: refreshToken, grant_type: "refresh_token" });
  cacheAcesso.set(refreshToken, { token: t.access_token, expira: Date.now() + t.expires_in * 1000 });
  return t.access_token;
}

function cabecalhos(acesso: string, loginCustomerId?: string | null): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${acesso}`, "Content-Type": "application/json" };
  if (loginCustomerId) h["login-customer-id"] = loginCustomerId;
  const dev = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  if (dev) h["developer-token"] = dev;
  return h;
}

/** Mensagem de erro legível a partir da resposta da Google Ads API. */
function erroGoogle(json: unknown, status: number) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = (Array.isArray(json) ? json[0] : json) as any;
  const detalhe = j?.error?.details?.[0]?.errors?.[0];
  const msg = detalhe?.message || j?.error?.message || `HTTP ${status}`;
  const codigo = detalhe?.errorCode ? Object.values(detalhe.errorCode)[0] : j?.error?.status;
  return new Error(codigo ? `${msg} (${codigo})` : msg);
}

/** Lista os IDs de contas a que o login tem acesso direto (contas e MCCs). */
export async function contasAcessiveis(acesso: string): Promise<string[]> {
  const res = await fetch(`${BASE}/customers:listAccessibleCustomers`, { headers: cabecalhos(acesso), cache: "no-store" });
  const json = await res.json();
  if (!res.ok) throw erroGoogle(json, res.status);
  return ((json.resourceNames ?? []) as string[]).map((r) => r.split("/")[1]);
}

/** Executa uma consulta GAQL, paginando até o fim. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function consultar(acesso: string, customerId: string, loginCustomerId: string | null, query: string): Promise<any[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linhas: any[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 50; i++) {
    let res: Response | undefined;
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      res = await fetch(`${BASE}/customers/${customerId}/googleAds:search`, {
        method: "POST",
        headers: cabecalhos(acesso, loginCustomerId),
        body: JSON.stringify(pageToken ? { query, pageToken } : { query }),
        cache: "no-store",
        signal: AbortSignal.timeout(60_000),
      });
      if (res.status !== 429 && res.status < 500) break;
      await new Promise((r) => setTimeout(r, 2000 * (tentativa + 1)));
    }
    const json = await res!.json();
    if (!res!.ok) throw erroGoogle(json, res!.status);
    linhas.push(...(json.results ?? []));
    pageToken = json.nextPageToken;
    if (!pageToken) break;
  }
  return linhas;
}

export type ContaGoogleEncontrada = {
  id: string;
  nome: string;
  moeda: string | null;
  fuso: string | null;
  status: string | null;
  loginCustomerId: string;
  gerenteNome: string;
};

/**
 * Descobre todas as contas de anúncio: as que você acessa direto e as que estão abaixo dos MCCs
 * (seu e das agências). Para contas de MCC, guarda o MCC como login-customer-id.
 */
export async function descobrirContas(acesso: string): Promise<{ contas: ContaGoogleEncontrada[]; erros: string[] }> {
  const raizes = await contasAcessiveis(acesso);
  const porId = new Map<string, ContaGoogleEncontrada>();
  const erros: string[] = [];
  for (const raiz of raizes) {
    try {
      const linhas = await consultar(acesso, raiz, raiz, `
        SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager,
               customer_client.status, customer_client.currency_code, customer_client.time_zone,
               customer_client.level, customer.descriptive_name, customer.manager
        FROM customer_client`);
      const nomeRaiz = linhas[0]?.customer?.descriptiveName ?? raiz;
      const raizEhMcc = Boolean(linhas[0]?.customer?.manager);
      for (const l of linhas) {
        const cc = l.customerClient;
        if (!cc || cc.manager) continue;
        const id = String(cc.id);
        const encontrada: ContaGoogleEncontrada = {
          id,
          nome: cc.descriptiveName || id,
          moeda: cc.currencyCode ?? null,
          fuso: cc.timeZone ?? null,
          status: cc.status ?? null,
          loginCustomerId: raiz,
          gerenteNome: raizEhMcc ? nomeRaiz : "Acesso direto",
        };
        // acesso direto tem preferência sobre o acesso via MCC
        const atual = porId.get(id);
        if (!atual || (!raizEhMcc && atual.gerenteNome !== "Acesso direto")) porId.set(id, encontrada);
      }
    } catch (e) {
      // contas canceladas ou sem permissão aparecem na lista, mas não respondem; seguimos com as outras
      erros.push(`${raiz}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { contas: [...porId.values()], erros };
}

export type LinhaCampanhaDia = {
  data: string;
  campaignId: string;
  campaignNome: string | null;
  campaignStatus: string | null;
  canal: string | null;
  gasto: number;
  impressoes: number;
  cliques: number;
  conversoes: number;
  valorConversoes: number;
  conversoesAcao: Record<string, number> | null;
  orcamentoDiario: number | null;
  orcamentoCompartilhado: boolean | null;
};

/** Métricas diárias por campanha + conversões separadas por ação de conversão. */
/** Gasto e conversões da conta por mês (para o histórico mensal): uma consulta só, mesmo para anos. */
export async function metricasMensais(
  acesso: string, customerId: string, loginCustomerId: string | null, desde: string, ate: string,
): Promise<{ mes: string; gasto: number; conversoes: number }[]> {
  const linhas = await consultar(acesso, customerId, loginCustomerId, `
    SELECT segments.month, metrics.cost_micros, metrics.conversions
    FROM customer
    WHERE segments.date BETWEEN '${desde}' AND '${ate}'`);
  return linhas.map((l) => ({
    mes: String(l.segments.month).slice(0, 10),
    gasto: Number(l.metrics?.costMicros ?? 0) / 1_000_000,
    conversoes: Number(l.metrics?.conversions ?? 0),
  }));
}

export async function metricasPorCampanha(
  acesso: string, customerId: string, loginCustomerId: string | null, desde: string, ate: string,
): Promise<LinhaCampanhaDia[]> {
  const periodo = `segments.date BETWEEN '${desde}' AND '${ate}'`;
  const linhas = await consultar(acesso, customerId, loginCustomerId, `
    SELECT segments.date, campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
           campaign_budget.amount_micros, campaign_budget.explicitly_shared,
           metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value
    FROM campaign
    WHERE ${periodo}`);
  const chave = (data: string, id: string) => `${data}|${id}`;
  const mapa = new Map<string, LinhaCampanhaDia>();
  for (const l of linhas) {
    const m = l.metrics ?? {};
    const item: LinhaCampanhaDia = {
      data: l.segments.date,
      campaignId: String(l.campaign.id),
      campaignNome: l.campaign.name ?? null,
      campaignStatus: l.campaign.status ?? null,
      canal: l.campaign.advertisingChannelType ?? null,
      gasto: Number(m.costMicros ?? 0) / 1_000_000,
      impressoes: Number(m.impressions ?? 0),
      cliques: Number(m.clicks ?? 0),
      conversoes: Number(m.conversions ?? 0),
      valorConversoes: Number(m.conversionsValue ?? 0),
      conversoesAcao: null,
      orcamentoDiario: l.campaignBudget?.amountMicros != null ? Number(l.campaignBudget.amountMicros) / 1_000_000 : null,
      orcamentoCompartilhado: l.campaignBudget?.explicitlyShared ?? null,
    };
    if (item.gasto || item.impressoes || item.cliques || item.conversoes) mapa.set(chave(item.data, item.campaignId), item);
  }

  // Segunda consulta só se houve conversão (economiza cota): qual ação gerou cada conversão.
  if ([...mapa.values()].some((x) => x.conversoes > 0)) {
    const porAcao = await consultar(acesso, customerId, loginCustomerId, `
      SELECT segments.date, campaign.id, segments.conversion_action_name, metrics.conversions
      FROM campaign
      WHERE ${periodo} AND metrics.conversions > 0`);
    for (const l of porAcao) {
      const item = mapa.get(chave(l.segments.date, String(l.campaign.id)));
      if (!item) continue;
      const nome = l.segments.conversionActionName ?? "Conversão";
      item.conversoesAcao = { ...(item.conversoesAcao ?? {}), [nome]: Number(l.metrics.conversions ?? 0) };
    }
  }
  return [...mapa.values()];
}

export const formatarIdGoogle = (id: string) => id.replace(/^(\d{3})(\d{3})(\d{4})$/, "$1-$2-$3");

// ---------- Ações rápidas (escrita) ----------

async function mutar(acesso: string, customerId: string, loginCustomerId: string | null, recurso: string, operacao: object) {
  const res = await fetch(`${BASE}/customers/${customerId}/${recurso}:mutate`, {
    method: "POST",
    headers: cabecalhos(acesso, loginCustomerId),
    body: JSON.stringify({ operations: [operacao] }),
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok) {
    const e = erroGoogle(json, res.status);
    if (/DEVELOPER_TOKEN_NOT_APPROVED|ACCESS_LEVEL|NOT_ALLOWED|PERMISSION_DENIED|USER_PERMISSION_DENIED/i.test(e.message)) {
      throw new Error(`O Google recusou a alteração: ${e.message}. Pode ser o nível de acesso da API (Explorer só lê; peça o Basic) ou o seu usuário nessa conta ser só leitura.`);
    }
    throw e;
  }
}

/** Pausa ou ativa uma campanha. */
export async function mudarStatusCampanhaGoogle(acesso: string, customerId: string, loginCustomerId: string | null, campaignId: string, ativo: boolean) {
  await mutar(acesso, customerId, loginCustomerId, "campaigns", {
    update: { resourceName: `customers/${customerId}/campaigns/${campaignId}`, status: ativo ? "ENABLED" : "PAUSED" },
    updateMask: "status",
  });
}

export type OrcamentoGoogle = { recurso: string; nome: string | null; diario: number; compartilhado: boolean; campanha: string | null };

/** Orçamento atual da campanha (lido na hora, para não alterar com base em dado velho). */
export async function orcamentoCampanhaGoogle(acesso: string, customerId: string, loginCustomerId: string | null, campaignId: string): Promise<OrcamentoGoogle | null> {
  const [l] = await consultar(acesso, customerId, loginCustomerId, `
    SELECT campaign.name, campaign_budget.resource_name, campaign_budget.name, campaign_budget.amount_micros, campaign_budget.explicitly_shared
    FROM campaign WHERE campaign.id = ${Number(campaignId)}`);
  if (!l?.campaignBudget?.resourceName) return null;
  return {
    recurso: l.campaignBudget.resourceName,
    nome: l.campaignBudget.name ?? null,
    diario: Number(l.campaignBudget.amountMicros ?? 0) / 1_000_000,
    compartilhado: Boolean(l.campaignBudget.explicitlyShared),
    campanha: l.campaign?.name ?? null,
  };
}

/** Muda o orçamento diário (em reais). */
export async function mudarOrcamentoGoogle(acesso: string, customerId: string, loginCustomerId: string | null, o: OrcamentoGoogle, novo: number) {
  // o Google exige múltiplos de 10.000 micros (R$ 0,01)
  const micros = String(Math.round(novo * 100) * 10_000);
  await mutar(acesso, customerId, loginCustomerId, "campaignBudgets", {
    update: { resourceName: o.recurso, amountMicros: micros },
    updateMask: "amount_micros",
  });
}

/** Orçamento da conta (limite de gastos aprovado e quanto já foi gasto dele). Null se não houver ou sem permissão. */
export async function orcamentoDaConta(acesso: string, customerId: string, loginCustomerId: string | null) {
  try {
    const linhas = await consultar(acesso, customerId, loginCustomerId, `
      SELECT account_budget.status, account_budget.approved_spending_limit_micros, account_budget.adjusted_spending_limit_micros,
             account_budget.amount_served_micros, account_budget.approved_spending_limit_type
      FROM account_budget WHERE account_budget.status = 'APPROVED'`);
    const b = linhas[0]?.accountBudget;
    const limite = b?.adjustedSpendingLimitMicros ?? b?.approvedSpendingLimitMicros;
    if (!b || limite == null) return null; // sem limite ou limite "infinito"
    return { limite: Number(limite) / 1_000_000, gasto: Number(b.amountServedMicros ?? 0) / 1_000_000 };
  } catch {
    return null; // conta sem faturamento configurado ou usuário sem acesso ao faturamento
  }
}

// ---------- Montagem de campanha de Pesquisa ----------

export type LocalSugerido = { id: string; nome: string; tipo: string };

const TIPO_LOCAL: Record<string, string> = {
  City: "Cidade", State: "Estado", Region: "Região", Country: "País", Municipality: "Município",
  Neighborhood: "Bairro", "Postal Code": "CEP", "Metro area": "Região metropolitana", District: "Distrito",
};

/** Busca de locais do Google (cidades, estados…), no Brasil primeiro. */
export async function buscarLocaisGoogle(acesso: string, loginCustomerId: string | null, q: string): Promise<LocalSugerido[]> {
  const pedir = async (countryCode?: string) => {
    const res = await fetch(`${BASE}/geoTargetConstants:suggest`, {
      method: "POST", headers: cabecalhos(acesso, loginCustomerId), cache: "no-store",
      body: JSON.stringify({ locale: "pt", ...(countryCode && { countryCode }), locationNames: { names: [q] } }),
    });
    const json = await res.json();
    if (!res.ok) throw erroGoogle(json, res.status);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((json.geoTargetConstantSuggestions ?? []) as any[]).map((s) => s.geoTargetConstant).filter((g) => g?.status !== "REMOVAL_PLANNED");
  };
  const [br, mundo] = await Promise.all([pedir("BR"), pedir().catch(() => [])]);
  const vistos = new Set<string>();
  return [...br, ...mundo]
    .filter((g) => g?.id && !vistos.has(String(g.id)) && !!vistos.add(String(g.id)))
    .slice(0, 20)
    .map((g) => ({ id: String(g.id), nome: String(g.canonicalName ?? g.name), tipo: TIPO_LOCAL[g.targetType] ?? g.targetType ?? "" }));
}

type TipoPalavra = "BROAD" | "PHRASE" | "EXACT";
type Extensoes = {
  sitelinks: { texto: string; descricao1: string; descricao2: string; url: string }[];
  frases: string[];
};
type Base = Extensoes & {
  nome: string;
  orcamentoDiario: number;
  lance: "maximizar_conversoes" | "cpa_desejado" | "maximizar_cliques";
  cpaDesejado: number;
  locais: string[];          // ids de geoTargetConstant
};

export type CampanhaPesquisa = Base & {
  parceiros: boolean;
  negativas: { texto: string; tipo: TipoPalavra }[];
  grupos: {
    nome: string;
    palavras: { texto: string; tipo: TipoPalavra }[];
    sufixoUrl: string;
    titulos: string[];
    descricoes: string[];
    url: string;
    caminho1: string;
    caminho2: string;
  }[];
};

export type CampanhaPmax = Base & {
  url: string;
  sufixoUrl: string;
  nomeEmpresa: string;
  titulos: string[];
  titulosLongos: string[];
  descricoes: string[];
  temas: string[];
  imagens: { tipo: "logo" | "paisagem" | "quadrada" | "retrato"; dados: string }[]; // dados = base64 (JPEG/PNG)
};

const IDIOMA_PORTUGUES = "languageConstants/1014";
const micros = (reais: number) => String(Math.round(reais * 100) * 10_000);

/** Gera nomes temporários (-1, -2…) para criar tudo numa chamada só. */
function contador() {
  let n = 0;
  return () => --n;
}

/** Operações comuns: orçamento, critérios (idioma e locais) e as extensões (sitelinks e frases de destaque). */
function opsBase(cid: string, camp: string, orc: string, c: Base, novo: () => number) {
  const ops: object[] = [
    { campaignBudgetOperation: { create: { resourceName: orc, name: `${c.nome} (${Date.now()})`, amountMicros: micros(c.orcamentoDiario), deliveryMethod: "STANDARD", explicitlyShared: false } } },
  ];
  const criterios: object[] = [
    { campaignCriterionOperation: { create: { campaign: camp, language: { languageConstant: IDIOMA_PORTUGUES } } } },
    ...c.locais.map((id) => ({ campaignCriterionOperation: { create: { campaign: camp, location: { geoTargetConstant: `geoTargetConstants/${id}` } } } })),
  ];
  const extensoes: object[] = [];
  for (const s of c.sitelinks) {
    const asset = `${cid}/assets/${novo()}`;
    extensoes.push({
      assetOperation: {
        create: {
          resourceName: asset, finalUrls: [s.url],
          sitelinkAsset: { linkText: s.texto, ...(s.descricao1 && s.descricao2 && { description1: s.descricao1, description2: s.descricao2 }) },
        },
      },
    }, { campaignAssetOperation: { create: { campaign: camp, asset, fieldType: "SITELINK" } } });
  }
  for (const f of c.frases) {
    const asset = `${cid}/assets/${novo()}`;
    extensoes.push(
      { assetOperation: { create: { resourceName: asset, calloutAsset: { calloutText: f } } } },
      { campaignAssetOperation: { create: { campaign: camp, asset, fieldType: "CALLOUT" } } },
    );
  }
  return { ops, criterios, extensoes };
}

const lanceDe = (c: Base) =>
  c.lance === "maximizar_cliques" ? { targetSpend: {} }
    : c.lance === "cpa_desejado" && c.cpaDesejado > 0 ? { maximizeConversions: { targetCpaMicros: micros(c.cpaDesejado) } }
    : { maximizeConversions: {} };

/** Manda as operações numa chamada só (tudo ou nada) e devolve o id da campanha criada. */
async function mutarTudo(acesso: string, customerId: string, loginCustomerId: string | null, ops: object[]) {
  const res = await fetch(`${BASE}/customers/${customerId}/googleAds:mutate`, {
    method: "POST", headers: cabecalhos(acesso, loginCustomerId), cache: "no-store",
    body: JSON.stringify({ mutateOperations: ops }), signal: AbortSignal.timeout(120_000),
  });
  const json = await res.json();
  if (!res.ok) {
    // erro com o texto que o Google recusou (ex.: política de anúncios, palavra-chave inválida, imagem fora do formato)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const erros = ((Array.isArray(json) ? json[0] : json)?.error?.details?.[0]?.errors ?? []) as any[];
    const lista = erros.slice(0, 4).map((e) => {
      const valor = e.trigger?.stringValue ? ` (“${e.trigger.stringValue}”)` : "";
      const pol = e.details?.policyViolationDetails?.externalPolicyName ?? e.details?.policyFindingDetails?.policyTopicEntries?.[0]?.topic;
      return `${e.message}${valor}${pol ? ` — política: ${pol}` : ""}`;
    });
    const e = lista.length ? new Error(lista.join(" · ")) : erroGoogle(json, res.status);
    if (/DEVELOPER_TOKEN_NOT_APPROVED|ACCESS_LEVEL|USER_PERMISSION_DENIED/i.test(e.message)) {
      throw new Error(`O Google recusou a criação: ${e.message}. Pode ser o nível de acesso da API (Explorer só lê; peça o Basic) ou o seu usuário nessa conta ser só leitura.`);
    }
    throw e;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const criada = ((json.mutateOperationResponses ?? []) as any[]).find((r) => r.campaignResult)?.campaignResult?.resourceName as string | undefined;
  return { campanhaId: criada?.split("/").pop() ?? null };
}

/**
 * Cria a campanha de Pesquisa inteira numa chamada só (orçamento, campanha PAUSADA, locais, idioma, negativas,
 * sitelinks, frases de destaque, grupos, palavras-chave e o anúncio responsivo de cada grupo). Tudo ou nada.
 */
export async function criarCampanhaPesquisa(acesso: string, customerId: string, loginCustomerId: string | null, c: CampanhaPesquisa) {
  const cid = `customers/${customerId}`;
  const novo = contador();
  const orc = `${cid}/campaignBudgets/${novo()}`;
  const camp = `${cid}/campaigns/${novo()}`;
  const { ops, criterios, extensoes } = opsBase(cid, camp, orc, c, novo);
  ops.push({
    campaignOperation: {
      create: {
        resourceName: camp, name: c.nome, status: "PAUSED", advertisingChannelType: "SEARCH", campaignBudget: orc,
        networkSettings: { targetGoogleSearch: true, targetSearchNetwork: c.parceiros, targetContentNetwork: false, targetPartnerSearchNetwork: false },
        // só quem está (ou costuma estar) no local, não quem "se interessa" por ele
        geoTargetTypeSetting: { positiveGeoTargetType: "PRESENCE", negativeGeoTargetType: "PRESENCE" },
        containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
        ...lanceDe(c),
      },
    },
  }, ...criterios);
  ops.push(...c.negativas.map((n) => ({ campaignCriterionOperation: { create: { campaign: camp, negative: true, keyword: { text: n.texto, matchType: n.tipo } } } })));
  for (const g of c.grupos) {
    const grupo = `${cid}/adGroups/${novo()}`;
    ops.push({ adGroupOperation: { create: { resourceName: grupo, name: g.nome, campaign: camp, status: "ENABLED", type: "SEARCH_STANDARD", ...(g.sufixoUrl && { finalUrlSuffix: g.sufixoUrl }) } } });
    for (const p of g.palavras) ops.push({ adGroupCriterionOperation: { create: { adGroup: grupo, status: "ENABLED", keyword: { text: p.texto, matchType: p.tipo } } } });
    ops.push({
      adGroupAdOperation: {
        create: {
          adGroup: grupo, status: "ENABLED",
          ad: {
            finalUrls: [g.url],
            responsiveSearchAd: {
              headlines: g.titulos.map((text) => ({ text })),
              descriptions: g.descricoes.map((text) => ({ text })),
              ...(g.caminho1 && { path1: g.caminho1 }), ...(g.caminho1 && g.caminho2 && { path2: g.caminho2 }),
            },
          },
        },
      },
    });
  }
  ops.push(...extensoes);
  return mutarTudo(acesso, customerId, loginCustomerId, ops);
}

const CAMPO_IMAGEM = { logo: "LOGO", paisagem: "MARKETING_IMAGE", quadrada: "SQUARE_MARKETING_IMAGE", retrato: "PORTRAIT_MARKETING_IMAGE" } as const;

/**
 * Cria a Performance Max numa chamada só: orçamento, campanha PAUSADA, locais, idioma, textos e imagens (como recursos),
 * nome da empresa e logo (diretrizes da marca, na campanha), grupo de recursos, temas de pesquisa e extensões. Tudo ou nada.
 */
export async function criarCampanhaPmax(acesso: string, customerId: string, loginCustomerId: string | null, c: CampanhaPmax) {
  const cid = `customers/${customerId}`;
  const novo = contador();
  const orc = `${cid}/campaignBudgets/${novo()}`;
  const camp = `${cid}/campaigns/${novo()}`;
  const { ops, criterios, extensoes } = opsBase(cid, camp, orc, c, novo);
  ops.push({
    campaignOperation: {
      create: {
        resourceName: camp, name: c.nome, status: "PAUSED", advertisingChannelType: "PERFORMANCE_MAX", campaignBudget: orc,
        geoTargetTypeSetting: { positiveGeoTargetType: "PRESENCE", negativeGeoTargetType: "PRESENCE" },
        containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
        // nome da empresa e logo ficam na campanha (diretrizes da marca)
        brandGuidelinesEnabled: true,
        ...(c.sufixoUrl && { finalUrlSuffix: c.sufixoUrl }),
        ...(c.lance === "cpa_desejado" && c.cpaDesejado > 0 ? { maximizeConversions: { targetCpaMicros: micros(c.cpaDesejado) } } : { maximizeConversions: {} }),
      },
    },
  }, ...criterios);

  // recursos: textos e imagens
  const ligacoes: { asset: string; campo: string }[] = [];
  const texto = (t: string, campo: string) => {
    const asset = `${cid}/assets/${novo()}`;
    ops.push({ assetOperation: { create: { resourceName: asset, textAsset: { text: t } } } });
    ligacoes.push({ asset, campo });
  };
  c.titulos.forEach((t) => texto(t, "HEADLINE"));
  c.titulosLongos.forEach((t) => texto(t, "LONG_HEADLINE"));
  c.descricoes.forEach((t) => texto(t, "DESCRIPTION"));
  const nomeEmpresa = `${cid}/assets/${novo()}`;
  ops.push({ assetOperation: { create: { resourceName: nomeEmpresa, textAsset: { text: c.nomeEmpresa } } } });
  let logo: string | null = null;
  c.imagens.forEach((im, i) => {
    const asset = `${cid}/assets/${novo()}`;
    ops.push({ assetOperation: { create: { resourceName: asset, name: `${c.nome} · ${im.tipo} ${i + 1} · ${Date.now()}`, type: "IMAGE", imageAsset: { data: im.dados } } } });
    if (im.tipo === "logo") { if (!logo) logo = asset; } else ligacoes.push({ asset, campo: CAMPO_IMAGEM[im.tipo] });
  });
  if (!logo) throw new Error("A Performance Max precisa de um logo.");
  ops.push(
    { campaignAssetOperation: { create: { campaign: camp, asset: nomeEmpresa, fieldType: "BUSINESS_NAME" } } },
    { campaignAssetOperation: { create: { campaign: camp, asset: logo, fieldType: "LOGO" } } },
  );

  const grupo = `${cid}/assetGroups/${novo()}`;
  ops.push({ assetGroupOperation: { create: { resourceName: grupo, name: `${c.nome} · Recursos`, campaign: camp, finalUrls: [c.url], status: "ENABLED" } } });
  ops.push(...ligacoes.map((l) => ({ assetGroupAssetOperation: { create: { assetGroup: grupo, asset: l.asset, fieldType: l.campo } } })));
  ops.push(...c.temas.map((t) => ({ assetGroupSignalOperation: { create: { assetGroup: grupo, searchTheme: { text: t } } } })));
  ops.push(...extensoes);
  return mutarTudo(acesso, customerId, loginCustomerId, ops);
}

// ---------- Detalhe para as sugestões com IA (lido na hora: grupos, palavras-chave e termos de pesquisa) ----------

export type GrupoMetricas = { campanhaId: string; campanha: string; id: string; nome: string; status: string; gasto: number; cliques: number; impressoes: number; conversoes: number };
export type PalavraMetricas = GrupoMetricas & { grupoId: string; grupo: string; criterioId: string; texto: string; correspondencia: string; qualidade: number | null };
export type TermoMetricas = { campanhaId: string; campanha: string; grupoId: string; grupo: string; termo: string; status: string; gasto: number; cliques: number; impressoes: number; conversoes: number };

const num = (x: unknown) => Number(x ?? 0) || 0;

/** Grupos, palavras-chave e termos de pesquisa de uma conta no período (só o que teve impressão/clique). */
export async function detalheParaSugestoes(acesso: string, customerId: string, loginCustomerId: string | null, desde: string, ate: string) {
  const periodo = `segments.date BETWEEN '${desde}' AND '${ate}'`;
  const [grupos, palavras, termos] = await Promise.all([
    consultar(acesso, customerId, loginCustomerId, `
      SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group.status,
             metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions
      FROM ad_group WHERE ${periodo} AND campaign.status != 'REMOVED' AND ad_group.status != 'REMOVED' AND metrics.impressions > 0`),
    consultar(acesso, customerId, loginCustomerId, `
      SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_criterion.criterion_id, ad_group_criterion.status,
             ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.quality_info.quality_score,
             metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions
      FROM keyword_view WHERE ${periodo} AND ad_group_criterion.status != 'REMOVED' AND metrics.impressions > 0
      ORDER BY metrics.cost_micros DESC LIMIT 60`),
    consultar(acesso, customerId, loginCustomerId, `
      SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, search_term_view.search_term, search_term_view.status,
             metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions
      FROM search_term_view WHERE ${periodo} AND metrics.clicks > 0
      ORDER BY metrics.cost_micros DESC LIMIT 80`).catch(() => []),
  ]);
  const m = (l: { metrics?: Record<string, unknown> }) => ({
    gasto: num(l.metrics?.costMicros) / 1_000_000, cliques: num(l.metrics?.clicks), impressoes: num(l.metrics?.impressions), conversoes: num(l.metrics?.conversions),
  });
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return {
    grupos: grupos.map((l: any): GrupoMetricas => ({
      campanhaId: String(l.campaign?.id), campanha: l.campaign?.name ?? "", id: String(l.adGroup?.id), nome: l.adGroup?.name ?? "", status: l.adGroup?.status ?? "", ...m(l),
    })).sort((a, b) => b.gasto - a.gasto),
    palavras: palavras.map((l: any): PalavraMetricas => ({
      campanhaId: String(l.campaign?.id), campanha: l.campaign?.name ?? "", grupoId: String(l.adGroup?.id), grupo: l.adGroup?.name ?? "",
      id: `${l.adGroup?.id}~${l.adGroupCriterion?.criterionId}`, criterioId: String(l.adGroupCriterion?.criterionId), nome: l.adGroupCriterion?.keyword?.text ?? "",
      texto: l.adGroupCriterion?.keyword?.text ?? "", correspondencia: l.adGroupCriterion?.keyword?.matchType ?? "", status: l.adGroupCriterion?.status ?? "",
      qualidade: l.adGroupCriterion?.qualityInfo?.qualityScore ?? null, ...m(l),
    })),
    termos: termos.map((l: any): TermoMetricas => ({
      campanhaId: String(l.campaign?.id), campanha: l.campaign?.name ?? "", grupoId: String(l.adGroup?.id), grupo: l.adGroup?.name ?? "",
      termo: l.searchTermView?.searchTerm ?? "", status: l.searchTermView?.status ?? "", ...m(l),
    })),
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** Pausa ou ativa um grupo de anúncios. */
export async function mudarStatusGrupoGoogle(acesso: string, customerId: string, loginCustomerId: string | null, grupoId: string, ativo: boolean) {
  await mutar(acesso, customerId, loginCustomerId, "adGroups", {
    update: { resourceName: `customers/${customerId}/adGroups/${grupoId}`, status: ativo ? "ENABLED" : "PAUSED" }, updateMask: "status",
  });
}

/** Pausa ou ativa uma palavra-chave (id = "grupo~critério"). */
export async function mudarStatusPalavraGoogle(acesso: string, customerId: string, loginCustomerId: string | null, id: string, ativo: boolean) {
  await mutar(acesso, customerId, loginCustomerId, "adGroupCriteria", {
    update: { resourceName: `customers/${customerId}/adGroupCriteria/${id}`, status: ativo ? "ENABLED" : "PAUSED" }, updateMask: "status",
  });
}

/** Palavra negativa na campanha. */
export async function negativarNaCampanhaGoogle(acesso: string, customerId: string, loginCustomerId: string | null, campanhaId: string, texto: string, tipo: "EXACT" | "PHRASE" | "BROAD") {
  await mutar(acesso, customerId, loginCustomerId, "campaignCriteria", {
    create: { campaign: `customers/${customerId}/campaigns/${campanhaId}`, negative: true, keyword: { text: texto, matchType: tipo } },
  });
}

/** Termo de pesquisa que converte vira palavra-chave (exata) no grupo. */
export async function adicionarPalavraGoogle(acesso: string, customerId: string, loginCustomerId: string | null, grupoId: string, texto: string, tipo: "EXACT" | "PHRASE" | "BROAD") {
  await mutar(acesso, customerId, loginCustomerId, "adGroupCriteria", {
    create: { adGroup: `customers/${customerId}/adGroups/${grupoId}`, status: "ENABLED", keyword: { text: texto, matchType: tipo } },
  });
}
