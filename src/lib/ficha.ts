import "server-only";
import { db } from "./db";

// Ficha do cliente: o que ficava dentro do cartão do Trello (briefing, links de redes/drive/site,
// informações importantes, onde estão os acessos). Guardada em configuracoes ("ficha:<cliente>"), sem SQL.
// Senhas NÃO ficam aqui: em "acessos" vai só onde encontrar (ex.: "Bitwarden › Clientes › Kiko").

export type LinkFicha = { rotulo: string; url: string };

export type Ficha = {
  briefing: string;      // o que vende, público, diferenciais, região, tom de voz (a IA também usa)
  informacoes: string;   // anotações livres: contatos, designer, combinados…
  acessos: string;       // onde estão os acessos (sem senha)
  links: LinkFicha[];
  atualizadoEm: string | null;
  trello?: string;       // link do cartão de origem, se veio do Trello
};

export const FICHA_VAZIA: Ficha = { briefing: "", informacoes: "", acessos: "", links: [], atualizadoEm: null };

const chave = (clienteId: string) => `ficha:${clienteId}`;
const LIMITE_TEXTO = 20_000;

export async function lerFicha(clienteId: string): Promise<Ficha> {
  const { data } = await db().from("configuracoes").select("valor").eq("chave", chave(clienteId)).maybeSingle();
  return data?.valor ? { ...FICHA_VAZIA, ...(data.valor as Partial<Ficha>) } : { ...FICHA_VAZIA };
}

/** Só links http(s) (e mailto/tel), sem repetir a mesma URL. */
export function limparLinks(links: unknown): LinkFicha[] {
  if (!Array.isArray(links)) return [];
  const vistos = new Set<string>();
  const saida: LinkFicha[] = [];
  for (const l of links as Partial<LinkFicha>[]) {
    const url = String(l?.url ?? "").trim();
    if (!/^(https?:\/\/|mailto:|tel:)/i.test(url) || url.length > 2000 || vistos.has(url)) continue;
    vistos.add(url);
    saida.push({ rotulo: String(l?.rotulo ?? "").trim().slice(0, 80) || rotuloDoLink(url), url });
  }
  return saida.slice(0, 60);
}

/** Nome curto para o link pelo endereço: Instagram, Drive, Site… */
export function rotuloDoLink(url: string) {
  let host = "";
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { return "Link"; }
  if (url.startsWith("mailto:")) return "E-mail";
  if (url.startsWith("tel:")) return "Telefone";
  const conhecidos: [RegExp, string][] = [
    [/instagram\.com/, "Instagram"], [/facebook\.com\/.*(adsmanager|business)|adsmanager\.facebook/, "Gerenciador Meta"],
    [/facebook\.com|fb\.com/, "Facebook"], [/drive\.google\.com/, "Drive"], [/docs\.google\.com\/spreadsheets/, "Planilha"],
    [/docs\.google\.com\/presentation/, "Apresentação"], [/docs\.google\.com/, "Documento"], [/ads\.google\.com/, "Google Ads"],
    [/wa\.me|whatsapp/, "WhatsApp"], [/canva\.com/, "Canva"], [/miro\.com/, "Miro"], [/mm\.tt|mindmeister/, "Mapa mental"],
    [/tiktok\.com/, "TikTok"], [/youtube\.com|youtu\.be/, "YouTube"], [/linkedin\.com/, "LinkedIn"], [/trello\.com/, "Trello"],
  ];
  for (const [re, nome] of conhecidos) if (re.test(url)) return nome;
  return /^lp\.|\.rds\.land|landing/.test(host) ? `Landing page (${host})` : host;
}

export async function salvarFicha(clienteId: string, f: Partial<Ficha>): Promise<Ficha> {
  const atual = await lerFicha(clienteId);
  const texto = (v: unknown, padrao: string) => (typeof v === "string" ? v.slice(0, LIMITE_TEXTO) : padrao);
  const nova: Ficha = {
    briefing: texto(f.briefing, atual.briefing),
    informacoes: texto(f.informacoes, atual.informacoes),
    acessos: texto(f.acessos, atual.acessos),
    links: f.links !== undefined ? limparLinks(f.links) : atual.links,
    atualizadoEm: new Date().toISOString(),
    ...(f.trello ?? atual.trello ? { trello: f.trello ?? atual.trello } : {}),
  };
  const { error } = await db().from("configuracoes").upsert({ chave: chave(clienteId), valor: nova, atualizado_em: nova.atualizadoEm });
  if (error) throw new Error(error.message);
  return nova;
}

/** Junta o que veio do Trello com o que já está na ficha (não apaga nada; texto igual não repete). */
export async function juntarNaFicha(clienteId: string, vindo: { informacoes: string; links: LinkFicha[]; trello?: string }) {
  const atual = await lerFicha(clienteId);
  // só os blocos (parágrafos) que ainda não estão na ficha: importar de novo não repete o que já veio
  const blocos = vindo.informacoes.split(/\n{2,}/).map((b) => b.trim()).filter((b) => b && !atual.informacoes.includes(b));
  const info = blocos.join("\n\n");
  const informacoes = !info ? atual.informacoes
    : [atual.informacoes.trim(), atual.informacoes.trim() ? `— Do Trello —\n${info}` : info].filter(Boolean).join("\n\n");
  return salvarFicha(clienteId, { informacoes, links: [...atual.links, ...vindo.links], trello: vindo.trello ?? atual.trello });
}

/** Briefing de todos os clientes que têm (para a IA e para buscas). */
export async function briefingDoCliente(clienteId: string) {
  const f = await lerFicha(clienteId).catch(() => FICHA_VAZIA);
  return f.briefing.trim();
}
