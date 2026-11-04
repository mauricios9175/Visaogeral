import "server-only";
import type { FunilRd } from "./rd";
import type { Utms } from "./highlevel";

// Kommo, API v4, com o token de longa duração de uma integração privada.
// O endereço da conta é https://<subdominio>.kommo.com.

export const STATUS_GANHO = 142;
export const STATUS_PERDIDO = 143;

/** "minhaempresa", "minhaempresa.kommo.com" ou o link inteiro → domínio da conta. */
export function dominioKommo(entrada: string | null | undefined) {
  const x = (entrada ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  if (!x) throw new Error("Informe o endereço da conta do Kommo (ex.: minhaempresa.kommo.com).");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(x)) throw new Error("Endereço do Kommo inválido. Use algo como minhaempresa.kommo.com.");
  return x.includes(".") ? x : `${x}.kommo.com`;
}

async function get<T>(dominio: string, caminho: string, token: string, params: Record<string, string> = {}): Promise<T | null> {
  const u = new URL(`https://${dominio}/api/v4/${caminho}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  for (let tentativa = 0; ; tentativa++) {
    const res = await fetch(u, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(25_000),
    }).catch((e: unknown) => {
      throw new Error(e instanceof Error && e.name === "TimeoutError" ? "O Kommo não respondeu a tempo." : `Falha ao acessar o Kommo (${dominio}): ${e}`);
    });
    // limite do Kommo: ~7 chamadas por segundo
    if (res.status === 429 && tentativa < 4) {
      await new Promise((r) => setTimeout(r, 1500 * 2 ** tentativa));
      continue;
    }
    if (res.status === 204) return null; // lista vazia
    const texto = await res.text();
    if (!res.ok) {
      if (res.status === 401) throw new Error("Token do Kommo inválido ou expirado. Gere um novo token de longa duração na integração.");
      if (res.status === 403) throw new Error("O token do Kommo não tem permissão (a integração precisa do acesso a CRM).");
      if (res.status === 404 && caminho === "leads/pipelines") throw new Error(`Conta ${dominio} não encontrada. Confira o endereço.`);
      throw new Error(`Kommo respondeu ${res.status}: ${texto.slice(0, 200)}`);
    }
    return JSON.parse(texto) as T;
  }
}

type StatusApi = { id: number; name: string; sort: number; type?: number };
type PipelineApi = { id: number; name: string; sort: number; _embedded?: { statuses?: StatusApi[] } };

/** As etapas do Kommo repetem ids entre funis (142 e 143 em todos), então a etapa do painel é "funil:etapa". */
export const idEtapaKommo = (pipeline: number | string, status: number | string) => `${pipeline}:${status}`;

/** Funis e etapas (sem "Ganho" e "Perdido", que viram o status do negócio). Também testa o token. */
export async function listarFunisKommo(token: string, subdominio: string | null): Promise<FunilRd[]> {
  const dominio = dominioKommo(subdominio);
  const r = await get<{ _embedded?: { pipelines?: PipelineApi[] } }>(dominio, "leads/pipelines", token);
  return (r?._embedded?.pipelines ?? [])
    .sort((a, b) => a.sort - b.sort)
    .map((p) => ({
      id: String(p.id),
      nome: p.name,
      etapas: (p._embedded?.statuses ?? [])
        .filter((s) => s.id !== STATUS_GANHO && s.id !== STATUS_PERDIDO)
        .sort((a, b) => a.sort - b.sort)
        .map((s, i) => ({ id: idEtapaKommo(p.id, s.id), nome: s.name, ordem: i + 1 })),
    }));
}

type CampoApi = { field_id: number; field_name?: string; field_code?: string | null; values?: { value?: unknown }[] };
export type LeadKommo = {
  id: number;
  name?: string | null;
  price?: number | null;
  responsible_user_id?: number;
  status_id: number;
  pipeline_id: number;
  created_at: number;
  closed_at?: number | null;
  loss_reason_id?: number | null;
  custom_fields_values?: CampoApi[] | null;
  _embedded?: { tags?: { name: string }[]; loss_reason?: { id: number; name: string }[] };
};

const valorDoCampo = (c: CampoApi) => (c.values ?? []).map((v) => v.value).filter((v) => v != null && v !== "").map(String).join(", ");

/** Campos preenchidos do lead como {nome: valor}, mais as etiquetas em "Etiquetas". */
export function camposDoLead(l: LeadKommo): Record<string, string> | null {
  const campos: Record<string, string> = {};
  for (const c of l.custom_fields_values ?? []) {
    const v = valorDoCampo(c);
    if (v) campos[c.field_name || c.field_code || String(c.field_id)] = v;
  }
  const tags = (l._embedded?.tags ?? []).map((t) => t.name).filter(Boolean);
  if (tags.length) campos.Etiquetas = tags.join(", ");
  return Object.keys(campos).length ? campos : null;
}

/** UTMs dos campos de rastreamento do Kommo (código UTM_SOURCE…) ou de campos com "utm" no nome. */
export function utmsDoLead(l: LeadKommo): Utms | null {
  const achar = (nome: string) => {
    const re = new RegExp(`^utm[ _-]?${nome}$`, "i");
    const c = (l.custom_fields_values ?? []).find((x) => re.test(x.field_code ?? "") || re.test((x.field_name ?? "").trim()));
    return c ? valorDoCampo(c) || null : null;
  };
  const u = { source: achar("source"), medium: achar("medium"), campaign: achar("campaign"), content: achar("content"), term: achar("term") };
  return Object.values(u).some(Boolean) ? u : null;
}

const unix = (iso: string, fim = false) => String(Math.floor(Date.parse(`${iso}T${fim ? "23:59:59" : "00:00:00"}-03:00`) / 1000));

/** Leads criados OU fechados entre as datas (AAAA-MM-DD). */
export async function listarLeadsKommo(token: string, subdominio: string | null, desde: string, ate: string) {
  const dominio = dominioKommo(subdominio);
  const porId = new Map<number, LeadKommo>();
  for (const campo of ["created_at", "closed_at"]) {
    for (let page = 1; page <= 200; page++) {
      const r = await get<{ _embedded?: { leads?: LeadKommo[] }; _links?: { next?: unknown } }>(dominio, "leads", token, {
        with: "loss_reason", limit: "250", page: String(page),
        [`filter[${campo}][from]`]: unix(desde), [`filter[${campo}][to]`]: unix(ate, true),
      });
      const leads = r?._embedded?.leads ?? [];
      for (const l of leads) porId.set(l.id, l);
      if (!r?._links?.next || !leads.length) break;
    }
  }
  return [...porId.values()];
}

/** Motivos de perda (id → nome) e usuários (id → nome) da conta; vazios se a conta não deixar ler. */
export async function nomesKommo(token: string, subdominio: string | null) {
  const dominio = dominioKommo(subdominio);
  const [motivos, usuarios] = await Promise.all([
    get<{ _embedded?: { loss_reasons?: { id: number; name: string }[] } }>(dominio, "leads/loss_reasons", token).catch(() => null),
    get<{ _embedded?: { users?: { id: number; name: string }[] } }>(dominio, "users", token, { limit: "250" }).catch(() => null),
  ]);
  return {
    motivos: new Map((motivos?._embedded?.loss_reasons ?? []).map((m) => [m.id, m.name])),
    usuarios: new Map((usuarios?._embedded?.users ?? []).map((u) => [u.id, u.name])),
  };
}
