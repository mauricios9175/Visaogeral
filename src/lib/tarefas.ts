import "server-only";
import { db } from "./db";
import { hojeISO, somarDias } from "./datas";
import { acharCliente } from "./analise";
import { dataDoTexto } from "./tarefas-texto";

// Tarefas do gestor, no lugar do "Coisas a fazer" do Trello: cada uma de um cliente (ou geral), com a data em que
// precisa ser feita. Sem data no texto = hoje; o que não foi feito vira "atrasada" no dia seguinte, para zerar.
// Guardadas em configuracoes ("tarefas"), sem precisar de SQL.

export type Tarefa = {
  id: string;
  titulo: string;
  clienteId: string | null;
  data: string;               // AAAA-MM-DD: quando fazer (ou, se aguardando, quando cobrar)
  aguardando?: boolean;       // falta informação / esperando o cliente
  nota?: string;
  feita: boolean;
  feitaEm?: string | null;
  criadaEm: string;
};

const CHAVE = "tarefas";
const GUARDAR_FEITAS_DIAS = 30;

export async function listarTarefas(): Promise<Tarefa[]> {
  const { data } = await db().from("configuracoes").select("valor").eq("chave", CHAVE).maybeSingle();
  return Array.isArray(data?.valor) ? (data.valor as Tarefa[]) : [];
}

async function gravar(lista: Tarefa[]) {
  // as feitas há mais de 30 dias saem (o histórico de ações do cliente continua no painel)
  const limite = somarDias(hojeISO(), -GUARDAR_FEITAS_DIAS);
  const fica = lista.filter((t) => !t.feita || (t.feitaEm ?? "").slice(0, 10) >= limite);
  const { error } = await db().from("configuracoes").upsert({ chave: CHAVE, valor: fica, atualizado_em: new Date().toISOString() });
  if (error) throw new Error(error.message);
  return fica;
}

/**
 * Cria a tarefa a partir do texto (digitado ou falado). O cliente vem do texto quando não foi escolhido;
 * a data vem do texto ("amanhã", "sexta", "dia 20", "semana que vem") quando não foi escolhida.
 */
export async function criarTarefa(entrada: { texto: string; clienteId?: string | null; data?: string | null; aguardando?: boolean }) {
  const texto = entrada.texto.trim();
  if (!texto) throw new Error("Escreva a tarefa.");
  const lida = dataDoTexto(texto);
  let clienteId = entrada.clienteId || null;
  if (entrada.clienteId === undefined) {
    const { data: clientes } = await db().from("clientes").select("id, nome").eq("ativo", true);
    try {
      clienteId = acharCliente(texto, (clientes ?? []) as { id: string; nome: string }[]).id;
    } catch {
      clienteId = null; // nenhum (ou empate): fica como tarefa geral, dá para escolher depois
    }
  }
  const nova: Tarefa = {
    id: crypto.randomUUID(),
    titulo: (entrada.data ? texto : lida.titulo).slice(0, 300),
    clienteId,
    data: entrada.data || lida.data || hojeISO(),
    ...(entrada.aguardando ? { aguardando: true } : {}),
    feita: false,
    criadaEm: new Date().toISOString(),
  };
  return gravar([...(await listarTarefas()), nova]);
}

export type MudancaTarefa = Partial<Pick<Tarefa, "titulo" | "clienteId" | "data" | "aguardando" | "nota" | "feita">>;

export async function mudarTarefa(id: string, m: MudancaTarefa) {
  const lista = await listarTarefas();
  const t = lista.find((x) => x.id === id);
  if (!t) throw new Error("Tarefa não encontrada (talvez já tenha sido apagada).");
  if (m.titulo !== undefined) {
    if (!m.titulo.trim()) throw new Error("O título não pode ficar vazio.");
    t.titulo = m.titulo.trim().slice(0, 300);
  }
  if (m.clienteId !== undefined) t.clienteId = m.clienteId || null;
  if (m.data !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.data)) throw new Error("Data inválida.");
    t.data = m.data;
  }
  if (m.aguardando !== undefined) t.aguardando = m.aguardando || undefined;
  if (m.nota !== undefined) t.nota = m.nota.trim().slice(0, 2000) || undefined;
  if (m.feita !== undefined) {
    t.feita = m.feita;
    t.feitaEm = m.feita ? new Date().toISOString() : null;
  }
  return gravar(lista);
}

export async function excluirTarefa(id: string) {
  return gravar((await listarTarefas()).filter((x) => x.id !== id));
}

/** Quantas tarefas pedem atenção hoje (de hoje ou atrasadas, sem as que estão aguardando o cliente). */
export function contarParaHoje(lista: Tarefa[], hoje = hojeISO()) {
  return lista.filter((t) => !t.feita && !t.aguardando && t.data <= hoje).length;
}
