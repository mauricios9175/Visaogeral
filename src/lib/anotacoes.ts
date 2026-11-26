import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { limparLinks, type LinkFicha } from "./ficha";

// Anotações gerais (o que ficava nos cartões do Trello sem cliente): links úteis, processos, ideias, contatos…
// Cada uma num cartão com título, texto, links e uma lista (ex.: "Links úteis"). Em configuracoes ("anotacoes"), sem SQL.
// Senhas não ficam aqui: só onde encontrar.

export type Anotacao = {
  id: string;
  titulo: string;
  texto: string;
  links: LinkFicha[];
  lista: string;          // agrupamento livre, como as listas do Trello
  fixada?: boolean;       // aparece primeiro
  criadaEm: string;
  atualizadaEm: string;
};

const CHAVE = "anotacoes";
export const LISTA_PADRAO = "Geral";

export async function listarAnotacoes(): Promise<Anotacao[]> {
  const { data } = await db().from("configuracoes").select("valor").eq("chave", CHAVE).maybeSingle();
  return Array.isArray(data?.valor) ? (data.valor as Anotacao[]) : [];
}

async function gravar(lista: Anotacao[]) {
  const { error } = await db().from("configuracoes").upsert({ chave: CHAVE, valor: lista, atualizado_em: new Date().toISOString() });
  if (error) throw new Error(error.message);
  return lista;
}

/** Cria (sem id) ou atualiza (com id) uma anotação. */
export async function salvarAnotacao(a: Partial<Anotacao>) {
  const todas = await listarAnotacoes();
  const agora = new Date().toISOString();
  const atual = a.id ? todas.find((x) => x.id === a.id) : undefined;
  if (a.id && !atual) throw new Error("Anotação não encontrada (talvez já tenha sido apagada).");
  const texto = (v: unknown, padrao: string, max: number) => (typeof v === "string" ? v.slice(0, max) : padrao);
  const nova: Anotacao = {
    id: atual?.id ?? randomUUID(),
    titulo: texto(a.titulo, atual?.titulo ?? "", 200).trim(),
    texto: texto(a.texto, atual?.texto ?? "", 30_000),
    links: a.links !== undefined ? limparLinks(a.links) : atual?.links ?? [],
    lista: texto(a.lista, atual?.lista ?? LISTA_PADRAO, 60).trim() || LISTA_PADRAO,
    ...((a.fixada ?? atual?.fixada) ? { fixada: true } : {}),
    criadaEm: atual?.criadaEm ?? agora,
    atualizadaEm: agora,
  };
  if (!nova.titulo && !nova.texto.trim() && !nova.links.length) throw new Error("Escreva um título, um texto ou um link.");
  return gravar(atual ? todas.map((x) => (x.id === nova.id ? nova : x)) : [nova, ...todas]);
}

export async function excluirAnotacao(id: string) {
  return gravar((await listarAnotacoes()).filter((x) => x.id !== id));
}
