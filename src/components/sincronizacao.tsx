"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Item = { id: string; nome: string; detalhe?: string; estado: "fila" | "rodando" | "ok" | "erro"; msg?: string };
type Tarefa = "semana" | "mes" | "crm";

const ROTULO: Record<Tarefa, string> = {
  semana: "Sincronizar últimos 7 dias",
  mes: "Recarregar últimos 30 dias",
  crm: "Sincronizar CRMs",
};

async function chamar(corpo: object) {
  const res = await fetch("/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const json = await res.json().catch(() => ({ erro: `Resposta inválida do servidor (${res.status})` }));
  if (!res.ok || json.erro) throw new Error(json.erro ?? `Erro ${res.status}`);
  return json;
}

/**
 * Sincroniza conta por conta (4 ao mesmo tempo), mostrando o progresso e o motivo de cada erro.
 * Cada conta é um pedido curto, então nada estoura o tempo limite; quem falha tenta mais uma vez.
 */
export function PainelSincronizacao() {
  const router = useRouter();
  const [tarefa, setTarefa] = useState<Tarefa | null>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const [fim, setFim] = useState<string | null>(null);

  const atualizar = (id: string, mudanca: Partial<Item>) =>
    setItens((xs) => xs.map((x) => (x.id === id ? { ...x, ...mudanca } : x)));

  async function iniciar(t: Tarefa) {
    setTarefa(t);
    setFim(null);
    setAviso(null);
    setItens([]);
    try {
      const inicio = await chamar({ etapa: "inicio" });
      setAviso(inicio.aviso);
      const lista: Item[] = (t === "crm"
        ? inicio.crms.map((c: { id: string; nome: string }) => ({ id: c.id, nome: c.nome }))
        : inicio.contas.map((c: { id: string; nome: string; cliente: string }) => ({ id: c.id, nome: c.nome, detalhe: c.cliente }))
      ).map((x: Item) => ({ ...x, estado: "fila" as const }));
      setItens(lista);

      const fila = [...lista];
      let linhas = 0;
      const erros: string[] = [];
      const trabalhador = async () => {
        for (let item = fila.shift(); item; item = fila.shift()) {
          atualizar(item.id, { estado: "rodando", msg: undefined });
          const corpo = t === "crm" ? { etapa: "crm", clienteId: item.id } : { etapa: "conta", id: item.id, modo: t };
          let ultimoErro = "";
          for (let tentativa = 1; tentativa <= 2; tentativa++) {
            try {
              const r = await chamar(corpo);
              linhas += r.linhas ?? 0;
              atualizar(item.id, { estado: "ok", msg: `${r.linhas ?? 0} linha(s)` });
              ultimoErro = "";
              break;
            } catch (e) {
              ultimoErro = e instanceof Error ? e.message : String(e);
              if (tentativa === 1) atualizar(item.id, { msg: "falhou, tentando de novo…" });
            }
          }
          if (ultimoErro) {
            erros.push(`${item.nome}${item.detalhe ? ` (${item.detalhe})` : ""}: ${ultimoErro}`);
            atualizar(item.id, { estado: "erro", msg: ultimoErro });
          }
        }
      };
      await Promise.all([trabalhador(), trabalhador(), trabalhador(), trabalhador()]);
      await chamar({ etapa: "fim", modo: t === "crm" ? "crm" : t, contas: lista.length, linhas, erros }).catch(() => {});
      setFim(erros.length ? `Concluído com ${erros.length} erro(s) — veja abaixo.` : `Concluído: ${lista.length} item(ns), ${linhas} linha(s).`);
      router.refresh();
    } catch (e) {
      setFim(`Não foi possível começar: ${e instanceof Error ? e.message : e}`);
    } finally {
      setTarefa(null);
    }
  }

  const feitos = itens.filter((x) => x.estado === "ok" || x.estado === "erro").length;
  const comErro = itens.filter((x) => x.estado === "erro");
  const botao = "rounded-lg border border-borda bg-superficie px-3 py-1.5 text-sm hover:border-destaque disabled:cursor-wait disabled:opacity-60";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(ROTULO) as Tarefa[]).map((t) => (
          <button key={t} onClick={() => iniciar(t)} disabled={tarefa !== null} className={botao}>
            {tarefa === t ? "Sincronizando…" : ROTULO[t]}
          </button>
        ))}
      </div>

      {(itens.length > 0 || fim) && (
        <div className="space-y-2 rounded-xl border border-borda bg-superficie p-4 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">{fim ?? `Sincronizando ${feitos} de ${itens.length}…`}</span>
            <span className="num text-xs text-texto-3">{feitos}/{itens.length}</span>
          </div>
          <div className="h-1.5 rounded-full bg-fundo">
            <div
              className="h-full rounded-full bg-destaque transition-all"
              style={{ width: `${itens.length ? (feitos / itens.length) * 100 : 0}%` }}
            />
          </div>
          {aviso && <p className="text-xs text-atencao">▲ {aviso}</p>}

          {comErro.length > 0 && (
            <ul className="space-y-1">
              {comErro.map((x) => (
                <li key={x.id} className="text-critico">
                  ■ <b>{x.nome}</b>{x.detalhe && <span className="text-texto-3"> · {x.detalhe}</span>}: {x.msg}
                </li>
              ))}
            </ul>
          )}

          <details>
            <summary className="cursor-pointer text-xs text-texto-3">Ver todos</summary>
            <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
              {itens.map((x) => (
                <li key={x.id} className="truncate">
                  {x.estado === "ok" ? <span className="text-bom">● </span>
                    : x.estado === "erro" ? <span className="text-critico">■ </span>
                    : x.estado === "rodando" ? <span className="text-atencao">◐ </span>
                    : <span className="text-texto-3">○ </span>}
                  {x.nome}{x.detalhe && <span className="text-texto-3"> · {x.detalhe}</span>}
                  {x.msg && <span className="text-texto-3"> — {x.msg}</span>}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}
