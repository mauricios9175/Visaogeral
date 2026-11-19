import "server-only";
import { db } from "./db";
import { hojeISO, somarDias } from "./datas";
import { sincronizarContaPorId } from "./sync";
import { sincronizarContaGooglePorId } from "./sync-google";

// Conta nova vinculada a um cliente: o painel puxa sozinho os últimos meses (Meta e Google), aos poucos, um mês por vez,
// para o cliente já abrir com histórico. Fila em configuracoes ("historico_fila:<plataforma>:<conta>": { desde, proximo }).

export const MESES_HISTORICO = 6;
type Plataforma = "meta" | "google";
type Pendente = { desde: string; proximo: string; criadoEm: string; erros?: number };

const chave = (p: Plataforma, conta: string) => `historico_fila:${p}:${conta}`;

/** Coloca a conta na fila (desde o 1º dia de 6 meses atrás); chamada ao vincular a conta a um cliente. */
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
    while (p.proximo <= hoje && Date.now() - inicio < orcamentoMs) {
      const ate = [somarDias(p.proximo, 29), hoje].sort()[0];
      try {
        if (plataforma === "google") await sincronizarContaGooglePorId(conta, p.proximo, ate);
        else await sincronizarContaPorId(conta, { desde: p.proximo, ate });
        p.proximo = somarDias(ate, 1);
        pedacos++;
      } catch (e) {
        p.erros = (p.erros ?? 0) + 1;
        erros.push(`${plataforma} ${conta}: ${e instanceof Error ? e.message : e}`);
        break; // tenta de novo na próxima rodada (3 erros seguidos: desiste da conta)
      }
    }
    if (p.proximo > hoje || (p.erros ?? 0) >= 3) {
      await db().from("configuracoes").delete().eq("chave", item.chave);
      if (p.proximo > hoje) {
        await db().from("configuracoes").upsert({ chave: `historico_${plataforma}:${conta}`, valor: p.desde, atualizado_em: new Date().toISOString() });
      }
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
