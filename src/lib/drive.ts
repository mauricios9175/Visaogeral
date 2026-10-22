import "server-only";
import { db } from "./db";
import { tokenDeAcesso } from "./google";

// Google Drive (só leitura): lista e baixa os criativos de uma pasta ou de um arquivo compartilhado.
const API = "https://www.googleapis.com/drive/v3/files";

export type ArquivoDrive = { id: string; nome: string; tipo: string; tamanho: number };

/** Aceita link de pasta (…/folders/ID), de arquivo (…/file/d/ID/…, ?id=ID) ou o próprio ID. */
export function idDoLink(link: string) {
  const t = link.trim();
  const pasta = t.match(/\/folders\/([\w-]{10,})/);
  if (pasta) return { tipo: "pasta" as const, id: pasta[1] };
  const arquivo = t.match(/\/d\/([\w-]{10,})/) ?? t.match(/[?&]id=([\w-]{10,})/);
  if (arquivo) return { tipo: "arquivo" as const, id: arquivo[1] };
  if (/^[\w-]{10,}$/.test(t)) return { tipo: "pasta" as const, id: t };
  return null;
}

async function chamar(url: string, acesso: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${acesso}` }, cache: "no-store" });
  if (!res.ok) {
    const corpo = await res.text();
    if (res.status === 403 && /insufficient|scope/i.test(corpo)) {
      throw new Error("O login do Google ainda não tem acesso ao Drive. Em Configurações → Google Ads, clique em “Conectar / reconectar Google” e permita o Drive.");
    }
    if (res.status === 404) throw new Error("Pasta ou arquivo não encontrado (confira o link e se o seu e-mail tem acesso).");
    throw new Error(`Google Drive respondeu ${res.status}: ${corpo.slice(0, 200)}`);
  }
  return res;
}

const ehCriativo = (tipo: string) => tipo.startsWith("image/") || tipo.startsWith("video/");

async function listarCom(acesso: string, link: string): Promise<ArquivoDrive[]> {
  const alvo = idDoLink(link);
  if (!alvo) throw new Error("Link do Drive inválido. Cole o link da pasta ou do arquivo.");
  const campos = "id,name,mimeType,size";
  if (alvo.tipo === "arquivo") {
    const f = await (await chamar(`${API}/${alvo.id}?fields=${campos}&supportsAllDrives=true`, acesso)).json();
    return ehCriativo(f.mimeType) ? [{ id: f.id, nome: f.name, tipo: f.mimeType, tamanho: Number(f.size ?? 0) }] : [];
  }
  const itens: ArquivoDrive[] = [];
  let pagina: string | undefined;
  do {
    const u = new URL(API);
    u.search = new URLSearchParams({
      q: `'${alvo.id}' in parents and trashed = false`,
      fields: `nextPageToken,files(${campos})`, pageSize: "200", orderBy: "name",
      supportsAllDrives: "true", includeItemsFromAllDrives: "true", ...(pagina ? { pageToken: pagina } : {}),
    }).toString();
    const r = await (await chamar(u.toString(), acesso)).json();
    for (const f of r.files ?? []) if (ehCriativo(f.mimeType)) itens.push({ id: f.id, nome: f.name, tipo: f.mimeType, tamanho: Number(f.size ?? 0) });
    pagina = r.nextPageToken;
  } while (pagina);
  return itens;
}

/** Lista os criativos do link tentando cada login do Google conectado (a pasta pode ser de qualquer um deles). */
export async function listarDoDrive(link: string) {
  const { data: tokens } = await db().from("tokens_google").select("refresh_token");
  if (!tokens?.length) throw new Error("Conecte o Google em Configurações para importar do Drive.");
  let ultimoErro: unknown;
  for (const t of tokens) {
    try {
      const acesso = await tokenDeAcesso(t.refresh_token);
      return { acesso, arquivos: await listarCom(acesso, link) };
    } catch (e) {
      ultimoErro = e;
    }
  }
  throw ultimoErro instanceof Error ? ultimoErro : new Error(String(ultimoErro));
}

export async function baixarDoDrive(acesso: string, id: string) {
  const res = await chamar(`${API}/${id}?alt=media&supportsAllDrives=true`, acesso);
  return res.arrayBuffer();
}
