import "server-only";
import type { FunilRd } from "./rd";

// GoHighLevel (e versões com marca própria, como o Ávora), API v2.
// Autenticação: token de "Integração Privada" da subconta (Configurações → Integrações Privado),
// enviado como Bearer. Toda chamada precisa do ID da subconta (location id).
const BASE = "https://services.leadconnectorhq.com";
const VERSAO = "2021-07-28";

async function get<T>(caminho: string, token: string, params: Record<string, string>): Promise<T> {
  const u = new URL(`${BASE}/${caminho}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  for (let tentativa = 0; ; tentativa++) {
    const res = await fetch(u, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, Version: VERSAO, Accept: "application/json" },
      signal: AbortSignal.timeout(25_000),
    }).catch((e: unknown) => {
      throw new Error(e instanceof Error && e.name === "TimeoutError" ? "Ávora/HighLevel não respondeu a tempo." : `Falha ao acessar o Ávora/HighLevel: ${e}`);
    });
    if (res.status === 429 && tentativa < 4) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** tentativa));
      continue;
    }
    const texto = await res.text();
    if (!res.ok) {
      if (res.status === 401) throw new Error("Token inválido ou sem permissão (confira os escopos da Integração Privada).");
      if (res.status === 403) throw new Error("Sem acesso a esta subconta: confira o ID da subconta e os escopos do token.");
      throw new Error(`Ávora/HighLevel respondeu ${res.status}: ${texto.slice(0, 200)}`);
    }
    return JSON.parse(texto) as T;
  }
}

type PipelineApi = { id: string; name: string; stages?: { id: string; name: string; position?: number }[] };

export async function listarFunisHL(token: string, locationId: string): Promise<FunilRd[]> {
  const r = await get<{ pipelines?: PipelineApi[] }>("opportunities/pipelines", token, { locationId });
  return (r.pipelines ?? []).map((p) => ({
    id: p.id,
    nome: p.name,
    etapas: (p.stages ?? [])
      .map((e, i) => ({ id: e.id, nome: e.name, ordem: (e.position ?? i) + 1 }))
      .sort((a, b) => a.ordem - b.ordem),
  }));
}

type CampoValor = { id: string; fieldValue?: unknown; value?: unknown; fieldValueString?: string; fieldValueNumber?: number };

export type OportunidadeApi = {
  id: string;
  name?: string;
  monetaryValue?: number;
  pipelineId?: string;
  pipelineStageId?: string;
  status?: "open" | "won" | "lost" | "abandoned" | string;
  source?: string | null;
  createdAt: string;
  updatedAt?: string;
  lastStatusChangeAt?: string | null;
  contact?: { name?: string; source?: string | null } | null;
  customFields?: CampoValor[];
};

type PaginaOportunidades = {
  opportunities?: OportunidadeApi[];
  meta?: { startAfter?: number | string; startAfterId?: string; nextPage?: number | null; total?: number };
};

/** Busca as oportunidades da subconta (todas as páginas, até um limite de segurança). */
export async function listarOportunidades(token: string, locationId: string, desde: string) {
  const todas: OportunidadeApi[] = [];
  const vistos = new Set<string>();
  const limiteData = Date.parse(`${desde}T00:00:00-03:00`);
  let cursor: { startAfter?: string; startAfterId?: string } = {};
  // A documentação já usou "location_id" e "locationId"; tenta um e, se recusado, o outro.
  let chaveLocal = "location_id";
  for (let pagina = 0; pagina < 100; pagina++) {
    let r: PaginaOportunidades;
    try {
      r = await get<PaginaOportunidades>("opportunities/search", token, { [chaveLocal]: locationId, limit: "100", ...cursor });
    } catch (e) {
      if (pagina > 0 || chaveLocal === "locationId" || !/ 4(00|22):/.test(String(e))) throw e;
      chaveLocal = "locationId";
      r = await get<PaginaOportunidades>("opportunities/search", token, { [chaveLocal]: locationId, limit: "100", ...cursor });
    }
    const lote = r.opportunities ?? [];
    let novos = 0;
    for (const o of lote) {
      if (vistos.has(o.id)) continue;
      vistos.add(o.id);
      novos++;
      // guarda só o que interessa: criado na janela ou com mudança de status na janela
      const mudou = o.lastStatusChangeAt ? Date.parse(o.lastStatusChangeAt) : 0;
      if (Date.parse(o.createdAt) >= limiteData || mudou >= limiteData) todas.push(o);
    }
    const m = r.meta;
    if (!lote.length || !novos || !m?.startAfterId || m.nextPage == null) break;
    cursor = { startAfter: String(m.startAfter ?? ""), startAfterId: m.startAfterId };
  }
  return todas;
}

/** Nomes dos campos personalizados de oportunidade ({id: nome}). Se faltar permissão, segue sem nomes. */
export async function nomesCamposHL(token: string, locationId: string) {
  try {
    const r = await get<{ customFields?: { id: string; name: string }[] }>(
      `locations/${locationId}/customFields`, token, { model: "opportunity" },
    );
    return new Map((r.customFields ?? []).map((c) => [c.id, c.name]));
  } catch {
    return new Map<string, string>();
  }
}

export function camposDaOportunidade(o: OportunidadeApi, nomes: Map<string, string>) {
  const campos: Record<string, string> = {};
  for (const c of o.customFields ?? []) {
    const v = c.fieldValue ?? c.value ?? c.fieldValueString ?? c.fieldValueNumber;
    if (v == null || v === "") continue;
    campos[nomes.get(c.id) ?? c.id] = Array.isArray(v) ? v.join(", ") : String(v);
  }
  return Object.keys(campos).length ? campos : null;
}
