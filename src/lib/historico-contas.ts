import "server-only";
import { db } from "./db";
import { hojeISO, somarDias } from "./datas";
import { sincronizarContaPorId } from "./sync";
import { sincronizarContaGooglePorId } from "./sync-google";
import { gravarHistorico, trazerCrmDoPeriodo } from "./historico";
import type { CursorHL } from "./crm/highlevel";

// Conta nova vinculada a um cliente (Meta, Google) ou CRM recém-conectado: o painel puxa sozinho os últimos meses,
// aos poucos, para o cliente já abrir com histórico. Quando tudo de um cliente termina, grava o histórico mensal
// (a base dos relatórios). Fila em configuracoes ("historico_fila:<plataforma>:<id>").
//   meta/google: id = conta, um mês por vez · crm: id = cliente, em partes (cursor) · mensal: id = cliente, um mês por vez

export const MESES_HISTORICO = 6;
type Plataforma = "meta" | "google" | "crm" | "mensal";
type Pendente = { desde: string; proximo: string; criadoEm: string; erros?: number; cursor?: CursorHL | null };

const chave = (p: Plataforma, conta: string) => `historico_fila:${p}:${conta}`;

/** Coloca na fila (desde o 1º dia de 6 meses atrás): conta vinculada (meta/google), CRM conectado (crm, id = cliente). */
export async function enfileirarHistorico(plataforma: Plataforma, conta: string) {
  const hoje = hojeISO();
  const [a, m] = hoje.split("-").map(Number);
  const t = m - 1 - MESES_HISTORICO;
  const desde = `${a + Math.floor(t / 12)}-${String(((t % 12) + 12) % 12 + 1).padStart(2, "0")}-01`;
  const valor: Pendente = { desde, proximo: desde, criadoEm: new Date().toISOString() };
  await db().from("configuracoes").upsert({ chave: chave(plataforma, conta), valor, atualizado_em: valor.criadoEm });
}

/**
 * Anda com a fila: puxa os pedaços de 30 dias que couberem no tempo (mais antigos primeiro). Quando uma conta
 * termina, sai da fila e fica marcada como "histórico puxado desde…" (o aviso amarelo some).
 */
export async function processarFilaHistorico(orcamentoMs = 230_000) {
  const inicio = Date.now();
  const { data } = await db().from("configuracoes").select("chave, valor").like("chave", "historico_fila:%");
  const fila = ((data ?? []) as { chave: string; valor: Pendente }[]).sort((x, y) => x.valor.criadoEm.localeCompare(y.valor.criadoEm));
  const hoje = hojeISO();
  let pedacos = 0;
  const erros: string[] = [];
  for (const item of fila) {
    const [, plataforma, conta] = item.chave.split(":") as [string, Plataforma, string];
    const p = { ...item.valor };
    const mesAtual = `${hoje.slice(0, 7)}-01`;
    while (Date.now() - inicio < orcamentoMs) {
      try {
        if (plataforma === "crm") {
          // CRM: tudo desde o mês, em partes (o cursor continua de onde parou)
          const r = await trazerCrmDoPeriodo(conta, p.desde, p.cursor ?? null);
          pedacos++;
          p.cursor = r.cursor;
          if (!r.cursor) { p.proximo = somarDias(hoje, 1); break; }
        } else if (plataforma === "mensal") {
          if (p.proximo > mesAtual) break;
          await gravarHistorico(conta, p.proximo, p.proximo);
          pedacos++;
          const [a, m] = p.proximo.split("-").map(Number);
          p.proximo = m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, "0")}-01`;
        } else {
          if (p.proximo > hoje) break;
          const ate = [somarDias(p.proximo, 29), hoje].sort()[0];
          if (plataforma === "google") await sincronizarContaGooglePorId(conta, p.proximo, ate);
          else await sincronizarContaPorId(conta, { desde: p.proximo, ate });
          p.proximo = somarDias(ate, 1);
          pedacos++;
        }
      } catch (e) {
        p.erros = (p.erros ?? 0) + 1;
        erros.push(`${plataforma} ${conta}: ${e instanceof Error ? e.message : e}`);
        break; // tenta de novo na próxima rodada (3 erros seguidos: desiste)
      }
    }
    const terminou = plataforma === "mensal" ? p.proximo > mesAtual : p.proximo > hoje;
    if (terminou || (p.erros ?? 0) >= 3) {
      await db().from("configuracoes").delete().eq("chave", item.chave);
      if (terminou && (plataforma === "meta" || plataforma === "google")) {
        await db().from("configuracoes").upsert({ chave: `historico_${plataforma}:${conta}`, valor: p.desde, atualizado_em: new Date().toISOString() });
      }
      // terminou uma fonte do cliente: se não sobrou nada dele na fila, grava o histórico mensal
      if (terminou && plataforma !== "mensal") await talvezGravarMensal(plataforma, conta, p.desde).catch(() => null);
    } else {
      await db().from("configuracoes").upsert({ chave: item.chave, valor: p, atualizado_em: new Date().toISOString() });
    }
    if (Date.now() - inicio >= orcamentoMs) break;
  }
  const { count } = await db().from("configuracoes").select("chave", { count: "exact", head: true }).like("chave", "historico_fila:%");
  return { pedacos, restantes: count ?? 0, erros: erros.slice(0, 5) };
}

/** Contas na fila (para a tela mostrar "puxando o histórico…"). */
export async function filaDeHistorico(): Promise<{ plataforma: Plataforma; conta: string; proximo: string; desde: string }[]> {
  const { data } = await db().from("configuracoes").select("chave, valor").like("chave", "historico_fila:%");
  return ((data ?? []) as { chave: string; valor: Pendente }[]).map((x) => {
    const [, plataforma, conta] = x.chave.split(":") as [string, Plataforma, string];
    return { plataforma, conta, proximo: x.valor.proximo, desde: x.valor.desde };
  });
}

/** Cliente dono da conta (meta/google) ou o próprio cliente (crm). */
async function clienteDe(plataforma: Plataforma, id: string) {
  if (plataforma === "crm" || plataforma === "mensal") return id;
  const tabela = plataforma === "google" ? "contas_google" : "contas_anuncio";
  const { data } = await db().from(tabela).select("cliente_id").eq("id", id).maybeSingle();
  return (data?.cliente_id as string | null) ?? null;
}

/** Sem mais nada do cliente na fila (contas e CRM): põe o histórico mensal dele na fila, desde o mesmo mês. */
async function talvezGravarMensal(plataforma: Plataforma, id: string, desde: string) {
  const clienteId = await clienteDe(plataforma, id);
  if (!clienteId) return;
  const fila = await filaDeHistorico();
  for (const x of fila) {
    if (x.plataforma === "mensal") continue;
    if ((await clienteDe(x.plataforma, x.conta)) === clienteId) return; // ainda tem fonte puxando
  }
  const valor: Pendente = { desde: `${desde.slice(0, 7)}-01`, proximo: `${desde.slice(0, 7)}-01`, criadoEm: new Date().toISOString() };
  await db().from("configuracoes").upsert({ chave: chave("mensal", clienteId), valor, atualizado_em: valor.criadoEm });
}
