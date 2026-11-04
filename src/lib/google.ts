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

export type CampanhaPesquisa = {
  nome: string;
  orcamentoDiario: number;
  lance: "maximizar_conversoes" | "cpa_desejado" | "maximizar_cliques";
  cpaDesejado: number;
  parceiros: boolean;
  locais: string[];          // ids de geoTargetConstant
  negativas: { texto: string; tipo: "BROAD" | "PHRASE" | "EXACT" }[];
  grupos: {
    nome: string;
    palavras: { texto: string; tipo: "BROAD" | "PHRASE" | "EXACT" }[];
    sufixoUrl: string;
    titulos: string[];
    descricoes: string[];
  }[];
  url: string;
  caminho1: string;
  caminho2: string;
};

const IDIOMA_PORTUGUES = "languageConstants/1014";
const micros = (reais: number) => String(Math.round(reais * 100) * 10_000);

/**
 * Cria a campanha de Pesquisa inteira numa chamada só (orçamento, campanha PAUSADA, locais, idioma, negativas,
 * grupos, palavras-chave e um anúncio responsivo por grupo). É tudo ou nada: se algo falhar, nada fica criado.
 */
export async function criarCampanhaPesquisa(acesso: string, customerId: string, loginCustomerId: string | null, c: CampanhaPesquisa) {
  const cid = `customers/${customerId}`;
  const orc = `${cid}/campaignBudgets/-1`;
  const camp = `${cid}/campaigns/-2`;
  const lance = c.lance === "maximizar_cliques" ? { targetSpend: {} }
    : c.lance === "cpa_desejado" && c.cpaDesejado > 0 ? { maximizeConversions: { targetCpaMicros: micros(c.cpaDesejado) } }
    : { maximizeConversions: {} };
  const ops: object[] = [
    { campaignBudgetOperation: { create: { resourceName: orc, name: `${c.nome} (${Date.now()})`, amountMicros: micros(c.orcamentoDiario), deliveryMethod: "STANDARD", explicitlyShared: false } } },
    {
      campaignOperation: {
        create: {
          resourceName: camp, name: c.nome, status: "PAUSED", advertisingChannelType: "SEARCH", campaignBudget: orc,
          networkSettings: { targetGoogleSearch: true, targetSearchNetwork: c.parceiros, targetContentNetwork: false, targetPartnerSearchNetwork: false },
          // só quem está (ou costuma estar) no local, não quem "se interessa" por ele
          geoTargetTypeSetting: { positiveGeoTargetType: "PRESENCE", negativeGeoTargetType: "PRESENCE" },
          containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
          ...lance,
        },
      },
    },
    { campaignCriterionOperation: { create: { campaign: camp, language: { languageConstant: IDIOMA_PORTUGUES } } } },
    ...c.locais.map((id) => ({ campaignCriterionOperation: { create: { campaign: camp, location: { geoTargetConstant: `geoTargetConstants/${id}` } } } })),
    ...c.negativas.map((n) => ({ campaignCriterionOperation: { create: { campaign: camp, negative: true, keyword: { text: n.texto, matchType: n.tipo } } } })),
  ];
  c.grupos.forEach((g, i) => {
    const grupo = `${cid}/adGroups/-${10 + i}`;
    ops.push({ adGroupOperation: { create: { resourceName: grupo, name: g.nome, campaign: camp, status: "ENABLED", type: "SEARCH_STANDARD", ...(g.sufixoUrl && { finalUrlSuffix: g.sufixoUrl }) } } });
    for (const p of g.palavras) ops.push({ adGroupCriterionOperation: { create: { adGroup: grupo, status: "ENABLED", keyword: { text: p.texto, matchType: p.tipo } } } });
    ops.push({
      adGroupAdOperation: {
        create: {
          adGroup: grupo, status: "ENABLED",
          ad: {
            finalUrls: [c.url],
            responsiveSearchAd: {
              headlines: g.titulos.map((text) => ({ text })),
              descriptions: g.descricoes.map((text) => ({ text })),
              ...(c.caminho1 && { path1: c.caminho1 }), ...(c.caminho1 && c.caminho2 && { path2: c.caminho2 }),
            },
          },
        },
      },
    });
  });

  const res = await fetch(`${BASE}/${cid}/googleAds:mutate`, {
    method: "POST", headers: cabecalhos(acesso, loginCustomerId), cache: "no-store",
    body: JSON.stringify({ mutateOperations: ops }), signal: AbortSignal.timeout(90_000),
  });
  const json = await res.json();
  if (!res.ok) {
    // erro com o texto que o Google recusou (ex.: política de anúncios, palavra-chave inválida)
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
