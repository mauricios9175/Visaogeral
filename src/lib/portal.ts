import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "./db";

// Link só de leitura para o cliente: /portal/<token>. O token é aleatório (impossível de adivinhar) e pode ser
// trocado ou desligado a qualquer momento. Fica guardado em configuracoes (portal:<token> → cliente).

const chaveToken = (token: string) => `portal:${token}`;
const chaveCliente = (clienteId: string) => `portal_cliente:${clienteId}`;
const TOKEN = /^[A-Za-z0-9_-]{30,60}$/;

export async function linkDoCliente(clienteId: string): Promise<string | null> {
  const { data } = await db().from("configuracoes").select("valor").eq("chave", chaveCliente(clienteId)).maybeSingle();
  return (data?.valor as { token?: string } | null)?.token ?? null;
}

/** Cria (ou troca) o link do cliente; o anterior para de funcionar. */
export async function gerarLink(clienteId: string) {
  await desligarLink(clienteId);
  const token = randomBytes(24).toString("base64url");
  const agora = new Date().toISOString();
  const { error } = await db().from("configuracoes").upsert([
    { chave: chaveToken(token), valor: { clienteId, criado_em: agora }, atualizado_em: agora },
    { chave: chaveCliente(clienteId), valor: { token, criado_em: agora }, atualizado_em: agora },
  ]);
  if (error) throw new Error(error.message);
  return token;
}

export async function desligarLink(clienteId: string) {
  const atual = await linkDoCliente(clienteId);
  if (atual) await db().from("configuracoes").delete().in("chave", [chaveToken(atual), chaveCliente(clienteId)]);
}

/** Cliente do link (null = link inválido, trocado ou desligado). */
export async function clienteDoLink(token: string): Promise<string | null> {
  if (!TOKEN.test(token)) return null;
  const { data } = await db().from("configuracoes").select("valor").eq("chave", chaveToken(token)).maybeSingle();
  const clienteId = (data?.valor as { clienteId?: string } | null)?.clienteId;
  if (!clienteId) return null;
  // confere o par (evita link antigo que sobrou)
  return (await linkDoCliente(clienteId)) === token ? clienteId : null;
}
