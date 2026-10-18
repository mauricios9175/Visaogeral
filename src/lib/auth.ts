// Login simples de um usuário só: senha em APP_PASSWORD, cookie assinado com SESSION_SECRET.
// Usa Web Crypto para funcionar tanto no proxy quanto nas server actions.

export const COOKIE_SESSAO = "sessao";
const DURACAO_DIAS = 30;

async function assinar(texto: string): Promise<string> {
  const segredo = process.env.SESSION_SECRET;
  if (!segredo) throw new Error("Configure SESSION_SECRET no .env");
  const chave = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const assinatura = await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(texto));
  return btoa(String.fromCharCode(...new Uint8Array(assinatura)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function criarSessao(): Promise<{ valor: string; maxAge: number }> {
  const expira = Date.now() + DURACAO_DIAS * 86_400_000;
  return { valor: `${expira}.${await assinar(String(expira))}`, maxAge: DURACAO_DIAS * 86_400 };
}

export async function sessaoValida(valor: string | undefined): Promise<boolean> {
  if (!valor) return false;
  const [expira, assinatura] = valor.split(".");
  if (!expira || !assinatura || Number(expira) < Date.now()) return false;
  return (await assinar(expira)) === assinatura;
}

export function senhaCorreta(senha: string): boolean {
  const certa = process.env.APP_PASSWORD;
  return Boolean(certa) && senha === certa;
}
