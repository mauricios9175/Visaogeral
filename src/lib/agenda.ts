import "server-only";
import { db } from "./db";
import { tokenDeAcesso, urlLoginGoogle } from "./google";
import { hojeISO, somarDias } from "./datas";

// Google Agenda: ver os compromissos e marcar reuniões com o cliente pelo painel.
// Login separado do Google Ads (pode ser outra conta Google: a da sua agenda). Usa o mesmo GOOGLE_CLIENT_ID e o
// mesmo endereço de retorno (/api/google/callback), então não precisa cadastrar nada novo de redirecionamento.
// Pode ter várias contas (ex.: a do trabalho e a pessoal): os compromissos de todas aparecem juntos.
// Guardado em configuracoes ("agenda_google"): [{ email, refresh_token }] (a primeira é a principal).

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
  conta: string;         // e-mail da agenda de onde veio
  clienteId: string | null;
  local: string | null;
};

export function urlConectarAgenda(redirect: string, state: string) {
  return urlLoginGoogle(redirect, `${PREFIXO_ESTADO}${state}`, ESCOPO_AGENDA);
}

type ContaAgenda = { email: string; refresh_token: string };

async function gravarContas(contas: ContaAgenda[]) {
  const { error } = await db().from("configuracoes").upsert({ chave: "agenda_google", valor: contas, atualizado_em: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

/** As agendas conectadas (a primeira é a principal, onde as reuniões são marcadas por padrão). */
export async function contasAgenda(): Promise<ContaAgenda[]> {
  const { data } = await db().from("configuracoes").select("valor").eq("chave", "agenda_google").maybeSingle();
  const v = data?.valor as ContaAgenda | ContaAgenda[] | undefined;
  // versão antiga: uma conta só (objeto)
  const lista = Array.isArray(v) ? v : v ? [v] : [];
  return lista.filter((c) => c?.refresh_token).map((c) => ({ email: c.email ?? "conta Google", refresh_token: c.refresh_token }));
}

/** Conecta (ou reconecta) uma conta; a mesma conta não repete. */
export async function salvarLoginAgenda(email: string, refreshToken: string) {
  const atuais = await contasAgenda();
  const i = atuais.findIndex((c) => c.email === email);
  if (i >= 0) atuais[i] = { email, refresh_token: refreshToken };
  else atuais.push({ email, refresh_token: refreshToken });
  await gravarContas(atuais);
}

export async function desconectarAgenda(email: string) {
  await gravarContas((await contasAgenda()).filter((c) => c.email !== email));
}

/** Deixa a conta como principal (as reuniões são marcadas nela por padrão). */
export async function tornarPrincipal(email: string) {
  const atuais = await contasAgenda();
  await gravarContas([...atuais.filter((c) => c.email === email), ...atuais.filter((c) => c.email !== email)]);
}

async function chamar<T>(conta: ContaAgenda, caminho: string, init: RequestInit = {}): Promise<T> {
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
    if (res.status === 403 || res.status === 401) throw new Error(`O Google recusou o acesso à agenda ${conta.email} (${msg}). Reconecte em Configurações.`);
    throw new Error(`Google Agenda (${conta.email}): ${msg}`);
  }
  return json as T;
}

type EventoApi = {
  id: string; iCalUID?: string; summary?: string; htmlLink?: string; location?: string; status?: string;
  start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string };
  hangoutLink?: string; conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  extendedProperties?: { private?: Record<string, string> };
};

function converter(e: EventoApi, conta: string, clientes?: { id: string; nome: string }[]): Evento {
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
    clienteId, conta,
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
  const [{ data: clientes }, contas] = await Promise.all([db().from("clientes").select("id, nome").eq("ativo", true), contasAgenda()]);
  if (!contas.length) throw new Error("Google Agenda não conectado (Configurações → Google Agenda).");
  const cli = (clientes ?? []) as { id: string; nome: string }[];
  // todas as agendas ao mesmo tempo; uma com erro não derruba as outras (só se todas falharem)
  const erros: string[] = [];
  const partes = await Promise.all(contas.map(async (c) => {
    try {
      const r = await chamar<{ items?: EventoApi[] }>(c, `/calendars/primary/events?${q}`);
      return (r.items ?? []).filter((e) => e.status !== "cancelled").map((e) => ({ e, ev: converter(e, c.email, cli) }));
    } catch (err) {
      erros.push(err instanceof Error ? err.message : String(err));
      return [];
    }
  }));
  if (erros.length === contas.length) throw new Error(erros[0]);
  // o mesmo compromisso nas duas agendas (convite) aparece uma vez só
  const vistos = new Set<string>();
  const eventos = partes.flat()
    .filter(({ e, ev }) => { const k = `${e.iCalUID ?? e.id}|${ev.inicio}`; return !vistos.has(k) && !!vistos.add(k); })
    .map(({ ev }) => ev)
    .sort((a, b) => a.inicio.localeCompare(b.inicio));
  return filtro.clienteId ? eventos.filter((e) => e.clienteId === filtro.clienteId) : eventos;
}

/**
 * Marca uma reunião na agenda principal. `inicio`: AAAA-MM-DDTHH:MM (horário de Brasília).
 * Com `meet`, o Google cria o link da chamada. `convidados`: e-mails (o Google manda o convite).
 */
export async function marcarReuniao(p: {
  titulo: string; inicio: string; minutos: number; clienteId?: string | null; descricao?: string; meet?: boolean; convidados?: string[];
  conta?: string; // e-mail da agenda (padrão: a principal)
}): Promise<Evento> {
  const contas = await contasAgenda();
  const conta = contas.find((c) => c.email === p.conta) ?? contas[0];
  if (!conta) throw new Error("Google Agenda não conectado (Configurações → Google Agenda).");
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
  const e = await chamar<EventoApi>(conta, `/calendars/primary/events?${q}`, { method: "POST", body: JSON.stringify(corpo) });
  return converter(e, conta.email);
}

export { horaDoTexto } from "./assistente-texto";
