import "server-only";

// RD Station CRM, API v1 (autenticação pelo token da conta, em ?token=).
// O token fica no RD CRM em: Perfil (canto superior direito) → Integrações → Token.
const BASE = "https://crm.rdstation.com/api/v1";

export type EtapaRd = { id: string; nome: string; ordem: number };
export type FunilRd = { id: string; nome: string; etapas: EtapaRd[] };

type Id = { id?: string; _id?: string };
const idDe = (o: Id | undefined | null) => String(o?.id ?? o?._id ?? "");

async function get<T>(caminho: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const u = new URL(`${BASE}/${caminho}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("token", token);
  for (let tentativa = 0; ; tentativa++) {
    const res = await fetch(u, { cache: "no-store", signal: AbortSignal.timeout(25_000) }).catch((e: unknown) => {
      throw new Error(
        e instanceof Error && e.name === "TimeoutError" ? "RD Station CRM não respondeu a tempo." : `Falha ao acessar o RD Station CRM: ${e}`,
      );
    });
    // limite de requisições: espera e tenta de novo
    if (res.status === 429 && tentativa < 4) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** tentativa));
      continue;
    }
    const texto = await res.text();
    if (!res.ok) {
      if (res.status === 401) throw new Error("Token do RD Station CRM inválido ou sem permissão.");
      throw new Error(`RD Station CRM respondeu ${res.status}: ${texto.slice(0, 200)}`);
    }
    return JSON.parse(texto) as T;
  }
}

type FunilApi = Id & { name: string; deal_stages?: (Id & { name: string; nickname?: string; order?: number })[] };

/** Funis e etapas da conta. Também serve para testar se o token funciona. */
export async function listarFunis(token: string): Promise<FunilRd[]> {
  const r = await get<FunilApi[] | { deal_pipelines: FunilApi[] }>("deal_pipelines", token);
  const lista = Array.isArray(r) ? r : r.deal_pipelines ?? [];
  return lista.map((p) => ({
    id: idDe(p),
    nome: p.name,
    etapas: (p.deal_stages ?? [])
      .map((e, i) => ({ id: idDe(e), nome: e.name, ordem: e.order ?? i + 1 }))
      .sort((a, b) => a.ordem - b.ordem),
  }));
}

export type NegocioApi = Id & {
  name?: string;
  amount_total?: number | string;
  win?: boolean | null;
  closed_at?: string | null;
  created_at: string;
  deal_stage?: Id & { name?: string };
  deal_pipeline?: Id;
  deal_source?: { name?: string } | null;
  campaign?: { name?: string } | null;
  deal_custom_fields?: { value?: unknown; custom_field?: { label?: string } }[];
  user?: { name?: string } | null;
};

/** Campos personalizados preenchidos do negócio, como {rótulo: valor}. */
export function camposDoNegocio(d: NegocioApi): Record<string, string> | null {
  const campos: Record<string, string> = {};
  for (const c of d.deal_custom_fields ?? []) {
    const rotulo = c.custom_field?.label;
    if (!rotulo || c.value == null || c.value === "") continue;
    campos[rotulo] = Array.isArray(c.value) ? c.value.join(", ") : String(c.value);
  }
  return Object.keys(campos).length ? campos : null;
}

type PaginaNegocios = { deals: NegocioApi[]; has_more?: boolean; total?: number };

/**
 * Negócios criados OU fechados entre as datas (AAAA-MM-DD). As duas buscas garantem que uma
 * venda fechada agora, de um lead antigo, também entre.
 */
export async function listarNegocios(token: string, desde: string, ate: string, pipelineId?: string | null) {
  const porId = new Map<string, NegocioApi>();
  for (const periodo of ["created_at_period", "closed_at_period"]) {
    for (let page = 1; page <= 100; page++) {
      const params: Record<string, string> = {
        page: String(page),
        limit: "200",
        [periodo]: "true",
        start_date: `${desde}T00:00:00`,
        end_date: `${ate}T23:59:59`,
      };
      if (pipelineId) params.deal_pipeline_id = pipelineId;
      const r = await get<PaginaNegocios>("deals", token, params);
      for (const d of r.deals ?? []) porId.set(idDe(d), d);
      if (!r.has_more || !r.deals?.length) break;
    }
  }
  return [...porId.values()];
}

/** UTM/campanha do negócio: campo Campanha do RD ou um campo personalizado com "utm"/"campanha" no nome. */
export function campanhaDoNegocio(d: NegocioApi): string | null {
  if (d.campaign?.name) return d.campaign.name;
  const campo = d.deal_custom_fields?.find((c) => /utm_campaign|utm campanha|campanha/i.test(c.custom_field?.label ?? ""));
  return campo?.value ? String(campo.value) : null;
}

/** UTMs guardadas em campos personalizados do negócio (ex.: "utm_source", "UTM Campaign"). */
export function utmsDoNegocioRd(d: NegocioApi) {
  const achar = (nome: string) => {
    const re = new RegExp(`utm[ _-]?${nome}`, "i");
    const c = d.deal_custom_fields?.find((x) => re.test(x.custom_field?.label ?? ""));
    return c?.value != null && c.value !== "" ? String(c.value) : null;
  };
  const u = { source: achar("source"), medium: achar("medium"), campaign: achar("campaign"), content: achar("content"), term: achar("term") };
  return Object.values(u).some(Boolean) ? u : null;
}

export { idDe as idNegocio };
