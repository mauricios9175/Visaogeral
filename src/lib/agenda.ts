import "server-only";
import { db } from "./db";
import { tokenDeAcesso, urlLoginGoogle } from "./google";
import { hojeISO, somarDias } from "./datas";

// Google Agenda: ver os compromissos e marcar reuniões com o cliente pelo painel.
// Login separado do Google Ads (pode ser outra conta Google: a da sua agenda). Usa o mesmo GOOGLE_CLIENT_ID e o
// mesmo endereço de retorno (/api/google/callback), então não precisa cadastrar nada novo de redirecionamento.
// Guardado em configuracoes ("agenda_google"): { email, refresh_token }.

const API = "https://www.googleapis.com/calendar/v3";
const FUSO = "America/Sao_Paulo";
export const ESCOPO_AGENDA = "https://www.googleapis.com/auth/calendar.events openid email";
export const PREFIXO_ESTADO = "agenda:";

export type Evento = {
  id: string;
  titulo: string;
  inicio: string;        // ISO com horário, ou AAAA-MM-DD (dia inteiro)
  fim: string;
  diaInteiro: boolean;
  link: string | null;   // abrir no Google Agenda
  meet: string | null;   // link do Google Meet
  clienteId: string | null;
  local: string | null;
};

export function urlConectarAgenda(redirect: string, state: string) {
  return urlLoginGoogle(redirect, `${PREFIXO_ESTADO}${state}`, ESCOPO_AGENDA);
}

export async function salvarLoginAgenda(email: string, refreshToken: string) {
  const { error } = await db().from("configuracoes").upsert({
    chave: "agenda_google", valor: { email, refresh_token: refreshToken }, atualizado_em: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

export async function contaAgenda(): Promise<{ email: string; refresh_token: string } | null> {
  const { data } = await db().from("configuracoes").select("valor").eq("chave", "agenda_google").maybeSingle();
  const v = data?.valor as { email?: string; refresh_token?: string } | undefined;
  return v?.refresh_token ? { email: v.email ?? "conta Google", refresh_token: v.refresh_token } : null;
}

export async function desconectarAgenda() {
  await db().from("configuracoes").delete().eq("chave", "agenda_google");
}

async function chamar<T>(caminho: string, init: RequestInit = {}): Promise<T> {
  const conta = await contaAgenda();
  if (!conta) throw new Error("Google Agenda não conectado (Configurações → Google Agenda).");
  const acesso = await tokenDeAcesso(conta.refresh_token);
  const res = await fetch(`${API}${caminho}`, {
    ...init, cache: "no-store",
    headers: { Authorization: `Bearer ${acesso}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 403 && /has not been used|disabled/i.test(msg)) {
      throw new Error("A Google Calendar API não está ativada no projeto do Google Cloud. Ative em console.cloud.google.com › APIs e serviços › Biblioteca › Google Calendar API.");
    }
    if (res.status === 403 || res.status === 401) throw new Error(`O Google recusou o acesso à agenda (${msg}). Reconecte o Google Agenda em Configurações.`);
    throw new Error(`Google Agenda: ${msg}`);
  }
  return json as T;
}

type EventoApi = {
  id: string; summary?: string; htmlLink?: string; location?: string; status?: string;
  start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string };
  hangoutLink?: string; conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  extendedProperties?: { private?: Record<string, string> };
};

function converter(e: EventoApi, clientes?: { id: string; nome: string }[]): Evento {
  const titulo = e.summary ?? "(sem título)";
  let clienteId = e.extendedProperties?.private?.clienteId ?? null;
  // eventos criados fora do painel: o cliente pelo nome no título
  if (!clienteId && clientes) {
    const t = semAcento(titulo);
    clienteId = clientes
      .filter((c) => c.nome.length >= 4 && t.includes(semAcento(c.nome)))
      .sort((a, b) => b.nome.length - a.nome.length)[0]?.id ?? null;
  }
  return {
    id: e.id, titulo,
    inicio: e.start?.dateTime ?? e.start?.date ?? "", fim: e.end?.dateTime ?? e.end?.date ?? "",
    diaInteiro: !e.start?.dateTime, link: e.htmlLink ?? null, local: e.location ?? null,
    meet: e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ?? null,
    clienteId,
  };
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Compromissos de hoje em diante (até `dias` dias), da agenda principal. */
export async function proximosEventos(dias = 7, filtro: { clienteId?: string } = {}): Promise<Evento[]> {
  const hoje = hojeISO();
  const q = new URLSearchParams({
    timeMin: `${hoje}T00:00:00-03:00`, timeMax: `${somarDias(hoje, dias)}T00:00:00-03:00`,
    singleEvents: "true", orderBy: "startTime", maxResults: "100", timeZone: FUSO,
  });
  const { data: clientes } = await db().from("clientes").select("id, nome").eq("ativo", true);
  const r = await chamar<{ items?: EventoApi[] }>(`/calendars/primary/events?${q}`);
  const eventos = (r.items ?? []).filter((e) => e.status !== "cancelled").map((e) => converter(e, (clientes ?? []) as { id: string; nome: string }[]));
  return filtro.clienteId ? eventos.filter((e) => e.clienteId === filtro.clienteId) : eventos;
}

/**
 * Marca uma reunião na agenda principal. `inicio`: AAAA-MM-DDTHH:MM (horário de Brasília).
 * Com `meet`, o Google cria o link da chamada. `convidados`: e-mails (o Google manda o convite).
 */
export async function marcarReuniao(p: {
  titulo: string; inicio: string; minutos: number; clienteId?: string | null; descricao?: string; meet?: boolean; convidados?: string[];
}): Promise<Evento> {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(p.inicio)) throw new Error("Escolha a data e o horário da reunião.");
  const fimDate = new Date(Date.parse(`${p.inicio}:00-03:00`) + Math.max(10, Math.min(p.minutos, 600)) * 60_000);
  // fim no fuso de Brasília, no mesmo formato
  const fim = new Intl.DateTimeFormat("sv-SE", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .format(fimDate).replace(" ", "T");
  const convidados = (p.convidados ?? []).map((x) => x.trim()).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)).slice(0, 20);
  const corpo = {
    summary: p.titulo.slice(0, 200),
    description: p.descricao?.slice(0, 4000) || undefined,
    start: { dateTime: `${p.inicio}:00`, timeZone: FUSO },
    end: { dateTime: `${fim}:00`, timeZone: FUSO },
    ...(convidados.length ? { attendees: convidados.map((email) => ({ email })) } : {}),
    ...(p.clienteId ? { extendedProperties: { private: { clienteId: p.clienteId, origem: "painel" } } } : {}),
    ...(p.meet ? { conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } } } : {}),
  };
  const q = new URLSearchParams({ ...(p.meet ? { conferenceDataVersion: "1" } : {}), ...(convidados.length ? { sendUpdates: "all" } : {}) });
  const e = await chamar<EventoApi>(`/calendars/primary/events?${q}`, { method: "POST", body: JSON.stringify(corpo) });
  return converter(e);
}

/** "15h", "15h30", "15:30", "às 9", "às 3 da tarde", "meio-dia" → "HH:MM" (ou null). */
export function horaDoTexto(texto: string): string | null {
  const t = semAcento(texto);
  if (/\bmeio[- ]dia\b/.test(t)) return "12:00";
  const m = /\b(\d{1,2})\s*(?:h|:)\s*(\d{2})?\b/.exec(t) ?? /\b(?:as|pras|para as|a partir das)\s+(\d{1,2})\b/.exec(t);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (/\b(da|de) (tarde|noite)\b/.test(t) && h < 12) h += 12;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}
